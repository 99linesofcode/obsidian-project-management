import { TaskData } from '../shared/TaskData.js';
import { withChecklistLinks } from '../vault/Checklist.js';
import { freePath } from '../vault/freePath.js';
import { parseAffiliation } from '../shared/parseAffiliation.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import { normalizedStem, stemOf } from '../shared/stemOf.js';
import { taskLinkFromAffiliation } from '../shared/taskLinkFromAffiliation.js';
import { TaskNoteMapper, slugify } from '../vault/TaskNoteMapper.js';
import { ToDoNoteParser } from '../vault/ToDoNoteParser.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import { readTemplate } from '../vault/readTemplate.js';
import type { VaultPort } from '../shared/VaultPort.js';
import type { CompleteTaskCascadeAction } from './CompleteTaskCascadeAction.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';

export interface ApplyTaskToVaultInput {
  // The winning canonical task — the remote's when the remote won.
  task: TaskData;
  // The vault's current canonical task, or null when no note exists yet.
  current: TaskData | null;
  projectName: string;
  // The connection whose mirror this write advances.
  connectionSlug: string;
  syncedAt: string;
  // Which side won the diff. A pull advances the github base after the durable
  // write; a push leaves the base to the code-host writer, which knows what it
  // wrote and owns that bookkeeping.
  origin: 'pull' | 'push';
  // The registry record, when the caller already resolved it (the code host half
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
      const parent = await this.resolveParent(input);
      const parentLink = await this.parentLink(parent);
      await this.createTaskNote.execute({
        url: await this.issueUrl(input, record),
        title: input.task.title,
        body: input.task.body,
        type: input.task.type,
        projectName: input.projectName,
        connectionSlug: input.connectionSlug,
        syncedAt: input.syncedAt,
        statusName: input.task.status,
        ...(parentLink === null ? {} : { parentLink }),
      });
      const created = await this.createdRecord(input, record);
      const path = created?.notePath ?? this.mappedPath(input);
      await this.refreshRecord(
        input,
        created,
        this.appliedTask(input, created?.id ?? input.task.id, path, parent),
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
    // The affiliation link for the resolved parent, so a pull on the parent
    // dimension rewrites the note's affiliation to the new parent (and a pull
    // on any other field preserves it). The link is the parent note's stem.
    const parentLink = await this.parentLink(parent);
    // The note body is the remote body with vault links re-attached, so a
    // remote-driven rewrite keeps the checklist items linked to their to-dos.
    const linkedBody = await this.linkedBody(
      input.task.body,
      input.projectName,
    );
    const template = await readTemplate(this.vault, this.taskTemplatePath);
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
        ...(parentLink === null ? {} : { parentLink }),
      },
    );

    const path = await this.desiredPath(input.current.notePath, rendered.path);
    const existing = await this.vault.getNoteByPath(input.current.notePath);
    // The rendered note is written as-is: the `todoist:` twin anchor is dead
    // (the registry is the identity source) and the cleanup step strips any
    // legacy one before the halves run.
    const content = rendered.content;
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
      : ((await this.githubHandle(input.connectionSlug, record.id)) ?? '');
  }

  // The github handle an entity holds, read from the port-grouped registry
  // because the handle no longer lives on the entity.
  private async githubHandle(
    connectionSlug: string,
    entityId: string,
  ): Promise<string | null> {
    return (
      (await this.syncState.findMirrorItemByEntity(connectionSlug, entityId))
        ?.handle ?? null
    );
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
      const item = await this.syncState.findMirrorItem(
        input.connectionSlug,
        url,
      );
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
    return new TaskData({
      id: id,
      notePath: notePath,
      mirrors: {},
      title: input.task.title,
      body: input.task.body,
      status: input.task.status,
      completedAt: input.task.completedAt,
      type: input.task.type,
      parent: parent,
      createdAt: input.task.createdAt,
      updatedAt: input.task.updatedAt,
    });
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
    if (normalizedStem(currentPath) === normalizedStem(renderedPath)) {
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

  // The affiliation link for a parent uuid: the parent note's stem. WHY a stem
  // and not the uuid: the note format is path-based presentation, so the uuid is
  // resolved to its current location at render time. A parent the registry no
  // longer knows renders no affiliation link; the next pass retries.
  private async parentLink(parentUuid: string | null): Promise<string | null> {
    if (parentUuid === null) {
      return null;
    }
    const record = await this.syncState.getEntity(parentUuid);
    return record === null ? null : stemOf(record.notePath);
  }

  // Re-attaches vault links to the remote body's checklist items. A to-do's
  // title is only recoverable from its filename slug, so an item links to the
  // first to-do whose filename stem equals slugify(item text); an item with no
  // matching to-do stays unlinked and re-promotes through the checklist
  // lifecycle on the next pass.
  private async linkedBody(body: string, projectName: string): Promise<string> {
    const bySlug = await this.todoPathsBySlug(projectName);
    return withChecklistLinks(
      body,
      (text) => bySlug.get(slugify(text)) ?? null,
    );
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
      const stem = stemOf(path);
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
        await this.syncState.setMirrorItem(
          input.projectName,
          input.connectionSlug,
          handle,
          {
            entityId: id,
            base: toDiffViewWithBody(applied),
          },
        );
      }
    }
  }
}
