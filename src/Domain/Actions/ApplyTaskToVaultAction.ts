import { TaskData } from '../DataTransferObjects/TaskData.js';
import { withChecklistLinks } from '../Notes/Checklist.js';
import { fillFrontmatterFields } from '../Notes/fillFrontmatterFields.js';
import { freePath } from '../Notes/freePath.js';
import { parseAffiliation } from '../Notes/parseAffiliation.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stemOf } from '../Notes/stemOf.js';
import { taskLinkFromAffiliation } from '../Notes/taskLinkFromAffiliation.js';
import { TaskNoteMapper, slugify } from '../Notes/TaskNoteMapper.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import { toDiffViewWithBody } from '../Reconciliation/toDiffView.js';
import type { EntityRecord, SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { CompleteTaskCascadeAction } from './CompleteTaskCascadeAction.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';

export interface ApplyTaskToVaultInput {
  // The winning canonical task — the remote's when the remote won.
  task: TaskData;
  // The vault's current canonical task, or null when no note exists yet.
  current: TaskData | null;
  projectName: string;
  syncedAt: string;
  // Which side won the diff. A pull advances the github base after the durable
  // write; a push leaves the base to the GitHub writer, which knows what it
  // wrote and owns that bookkeeping.
  origin: 'pull' | 'push';
  // The registry record, when the caller already resolved it (the GitHub half
  // resolves by mirror handle). Falls back to a note-path lookup.
  record?: EntityRecord | null;
}

// The vault writer: renders a winning canonical task onto its note, writing
// only the fields that differ, and updates the registry record. Absorbs the
// write paths of ApplyRemoteChange (rename on title change, body/status
// rewrite, checklist re-linking) and CreateTaskNote (note creation for an
// untracked issue, look-up-before-create). The note body carries the checklist
// line; the checklist ↔ to-do consistency itself runs as a retained chain step
// (it must run for every task note, not only on a pull). The dt-13 cascade rule
// (t6) lives in the composed CompleteTaskCascadeAction and fires here whenever
// a done status is applied, whatever origin the winning task came from.
export class ApplyTaskToVaultAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly taskTemplatePath: string,
    private readonly completeTaskCascade: CompleteTaskCascadeAction,
  ) {}

  async execute(input: ApplyTaskToVaultInput): Promise<void> {
    const record =
      input.record ??
      (input.current === null
        ? null
        : await this.syncState.findByNotePath(input.current.notePath));

    // An untracked issue has no note: materialise it. The create action is
    // idempotent (registry look-up before create), so an already-registered
    // issue is left untouched.
    if (input.current === null) {
      await this.createTaskNote.execute({
        url: await this.issueUrl(input, record),
        title: input.task.title,
        body: input.task.body,
        type: input.task.type,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
        statusName: input.task.status,
      });
      const created = await this.createdRecord(input, record);
      const path = created?.notePath ?? this.mappedPath(input);
      await this.refreshRecord(
        input,
        created,
        this.appliedTask(
          input,
          created?.id ?? input.task.id,
          path,
          await this.resolveParent(input),
        ),
      );
      await this.completeTaskCascade.execute({
        notePath: path,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
      });
      return;
    }

    const id = record?.id ?? input.current.id ?? input.task.id;
    const parent = await this.resolveParent(input);
    // The note body is the remote body with vault links re-attached, so a
    // remote-driven rewrite keeps the checklist items linked to their to-dos.
    const linkedBody = await this.linkedBody(
      input.task.body,
      input.projectName,
    );
    const template = await this.readTemplate();
    const rendered = TaskNoteMapper.render(
      template,
      {
        type: input.task.type || input.current.type,
        title: input.task.title,
        body: linkedBody,
        createdAt: input.current.createdAt,
      },
      {
        projectName: input.projectName,
        syncedAt: input.syncedAt,
        statusName: input.task.status,
      },
    );

    const path = await this.desiredPath(input.current.notePath, rendered.path);
    const existing = await this.vault.getNoteByPath(input.current.notePath);
    // A task note's `todoist` anchor is vault-owned identity, not a synced
    // field: a remote-driven rewrite must carry it over, or the to-do
    // projection can no longer find the task's twin and the to-dos detach.
    const content = withTodoistAnchor(rendered.content, existing?.content);
    if (input.current.notePath !== path) {
      await this.vault.renameNote(input.current.notePath, path);
    }
    if ((existing?.content ?? '') !== content) {
      await this.vault.writeNote(path, content);
    }

    // The dt-13 fan-out: a done status applied here also completes the task's
    // checklist line and its still-open to-dos; a reopen mirrors the checklist
    // line but never reopens the to-dos (asymmetric, by decision).
    await this.completeTaskCascade.execute({
      notePath: path,
      projectName: input.projectName,
      syncedAt: input.syncedAt,
    });

    await this.refreshRecord(
      input,
      record,
      this.appliedTask(input, id, path, parent),
    );
  }

  // The winning task's issue url: the registry's github handle when the entity
  // is tracked, otherwise the live-view handle the remote mapper carried.
  private async issueUrl(
    input: ApplyTaskToVaultInput,
    record: EntityRecord | null,
  ): Promise<string> {
    if (input.task.mirrors.github !== undefined) {
      return input.task.mirrors.github;
    }
    return record === null
      ? ''
      : ((await this.githubHandle(record.id, input.projectName)) ?? '');
  }

  // The github handle an entity holds, read from the port-grouped registry
  // because the handle no longer lives on the entity.
  private async githubHandle(
    entityId: string,
    projectName: string,
  ): Promise<string | null> {
    for (const entry of await this.syncState.listMirrorItems(
      projectName,
      'github',
    )) {
      if (entry.item.entityId === entityId) {
        return entry.handle;
      }
    }
    return null;
  }

  // The record CreateTaskNoteAction just wrote, so the create path can advance
  // its base and reach the note for the cascade. Resolved by mirror when the
  // issue has a url, else by the mapped note path.
  private async createdRecord(
    input: ApplyTaskToVaultInput,
    record: EntityRecord | null,
  ): Promise<EntityRecord | null> {
    const url = await this.issueUrl(input, record);
    if (url !== '') {
      const item = await this.syncState.findMirrorItem('github', url);
      return item === null ? null : this.syncState.getEntity(item.entityId);
    }
    return await this.syncState.findByNotePath(this.mappedPath(input));
  }

  // The applied task as it now stands on the vault: the hub id and the note's
  // current path, with the winning content and the resolved parent. The diff
  // base is taken from this shape, never from the pre-write winning task.
  private appliedTask(
    input: ApplyTaskToVaultInput,
    id: string,
    notePath: string,
    parent: string | null,
  ): TaskData {
    return new TaskData(
      id,
      notePath,
      {}, // a diff base carries no handles
      input.task.title,
      input.task.body,
      input.task.status,
      input.task.completedAt,
      input.task.type,
      parent,
      input.task.createdAt,
      input.task.updatedAt,
    );
  }

  // The mapped note path for a task — used to reach a freshly created note for
  // the cascade without re-rendering it.
  private mappedPath(input: ApplyTaskToVaultInput): string {
    return TaskNoteMapper.map(
      {
        type: '',
        title: input.task.title,
        body: '',
        createdAt: null,
      },
      {
        projectName: input.projectName,
        syncedAt: '',
        statusName: '',
      },
    ).path;
  }

  // The template note's content, or null when it does not exist — render
  // falls back to the built-in frontmatter.
  private async readTemplate(): Promise<string | null> {
    const note = await this.vault.getNoteByPath(this.taskTemplatePath);
    return note?.content ?? null;
  }

  // The note path a title move should land at. A file keeps its name when only
  // its content moved: filenames carry zero identity weight, and legacy
  // `<remoteId>-slug` names must survive untouched (the no-mass-rename rule).
  private async desiredPath(
    currentPath: string,
    renderedPath: string,
  ): Promise<string> {
    if (currentPath === renderedPath) {
      return renderedPath;
    }
    if (stemSlug(currentPath) === stemSlug(renderedPath)) {
      return currentPath;
    }
    // A real title move: land at the new slug, ordinal-suffixed if another
    // note already claims it.
    return await freePath(this.vault, renderedPath);
  }

  // Resolves the winning task's parent to its hub uuid. A remote mapper may
  // already carry the parent as a uuid; a vault note carries it as an
  // affiliation link. Both resolve through the registry. The mapper cannot do
  // this (it is pure/sync); the lookup lives here. An unresolved parent stays
  // null and the next pass retries once the parent note is known.
  private async resolveParent(
    input: ApplyTaskToVaultInput,
  ): Promise<string | null> {
    const direct = await this.resolveParentRef(
      input.task.parent,
      input.projectName,
    );
    if (direct !== null) {
      return direct;
    }
    if (input.current === null) {
      return null;
    }
    const note = await this.vault.getNoteByPath(input.current.notePath);
    if (note === null) {
      return null;
    }
    const fields = splitFrontmatter(note.content)?.fields;
    if (fields === undefined) {
      return null;
    }
    const link = taskLinkFromAffiliation(
      parseAffiliation(fields.get('affiliation')),
      input.projectName,
    );
    return await this.resolveParentRef(link, input.projectName);
  }

  // A parent reference is a uuid when the registry already knows it, otherwise
  // an affiliation link target. A link target may be a full note path or a bare
  // stem, so the taken and todos folders are tried before giving up.
  private async resolveParentRef(
    ref: string | null,
    projectName: string,
  ): Promise<string | null> {
    if (ref === null || ref === '') {
      return null;
    }
    if ((await this.syncState.getEntity(ref)) !== null) {
      return ref;
    }
    for (const candidate of [
      ref,
      `Projecten/${projectName}/taken/${ref}.md`,
      `Projecten/${projectName}/todos/${ref}.md`,
    ]) {
      const record = await this.syncState.findByNotePath(candidate);
      if (record !== null) {
        return record.id;
      }
    }
    return null;
  }

  // Re-attaches vault links to the remote body's checklist items. A to-do's
  // title is only recoverable from its filename slug, so an item links to the
  // first to-do whose filename stem equals slugify(item text); an item with no
  // matching to-do stays unlinked and re-promotes through the checklist
  // lifecycle on the next pass.
  private async linkedBody(body: string, projectName: string): Promise<string> {
    const bySlug = await this.todoPathsBySlug(projectName);
    return withChecklistLinks(body, (text) => bySlug.get(slugify(text)) ?? null);
  }

  // The project's to-do paths keyed by filename stem. Only notes that parse as
  // to-dos are considered; on a slug collision the first path wins.
  private async todoPathsBySlug(
    projectName: string,
  ): Promise<Map<string, string>> {
    const bySlug = new Map<string, string>();
    const folder = `Projecten/${projectName}/todos`;

    for (const path of await this.vault.listNotesInFolder(folder)) {
      const note = await this.vault.getNoteByPath(path);
      if (!note || ToDoNoteParser.parse(note.content) === null) {
        continue;
      }
      const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
      if (!bySlug.has(stem)) {
        bySlug.set(stem, path);
      }
    }

    return bySlug;
  }

  // Updates the registry: the note's location, and — only on a pull — the
  // github mirror item's base.
  private async refreshRecord(
    input: ApplyTaskToVaultInput,
    record: EntityRecord | null,
    applied: TaskData,
  ): Promise<void> {
    const id = record?.id ?? applied.id;
    if (id === '') {
      return;
    }
    await this.syncState.setEntity({ id, notePath: applied.notePath });
    if (input.origin === 'pull') {
      const handle = await this.issueUrl(input, record);
      if (handle !== '') {
        // WHY the base advances only here, after the durable write: a base
        // advanced before the write lands makes the next pass compare the
        // remote against a base that already claims the new state, so the
        // remote's still-stale value reads as a fresh change and reverts the
        // vault (the revert bug).
        await this.syncState.setMirrorItem(input.projectName, 'github', handle, {
          entityId: id,
          base: toDiffViewWithBody(applied),
        });
      }
    }
  }
}

// The comparison slug of a note stem, ignoring a legacy `<remoteId>-` prefix:
// `<remoteId>-fix-the-bug` and `fix-the-bug` name the same title.
function stemSlug(notePath: string): string {
  return stemOf(notePath).replace(/^\d+-/, '').toLowerCase();
}

// Carries the existing note's `todoist` anchor into a freshly rendered note.
// The anchor is vault-owned identity; the renderer's managed frontmatter does
// not include it, so a remote rewrite would otherwise drop it.
function withTodoistAnchor(
  content: string,
  existing: string | undefined,
): string {
  const anchor =
    existing === undefined
      ? ''
      : (splitFrontmatter(existing)?.fields.get('todoist') ?? '');
  if (anchor === '') {
    return content;
  }
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return content;
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    return content;
  }
  const frontmatter = fillFrontmatterFields(
    lines.slice(0, closing + 1),
    new Map([['todoist', anchor]]),
  );
  return [...frontmatter, ...lines.slice(closing + 1)].join('\n');
}
