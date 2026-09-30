import { laneForSection } from '../Board/laneForSection.js';
import { fillFrontmatterFields } from '../Notes/fillFrontmatterFields.js';
import { isMirroredPath } from '../Notes/isMirroredPath.js';
import { parseAffiliation } from '../Notes/parseAffiliation.js';
import { stemOf } from '../Notes/stemOf.js';
import { stripLink } from '../Notes/stripLink.js';
import { slugify } from '../Notes/TaskNoteMapper.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { withStatus } from '../Notes/TaskNoteParser.js';
import { Mirror } from '../DataTransferObjects/Mirror.js';
import { TaskData } from '../DataTransferObjects/TaskData.js';
import { toDiffViewWithBody } from '../Reconciliation/toDiffView.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { EntityRecord, SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { PropagateStatusAction } from './PropagateStatusAction.js';
import type { RelinkRenamedTodoAction } from './RelinkRenamedTodoAction.js';
import type { RelocateTaskStatusAction } from './RelocateTaskStatusAction.js';

export interface ApplyTodoistRemoteChangesInput {
  projectName: string;
  projectId: string;
  syncedAt: string;
}

// The vault-owned fields the verdict reads off a mirrored note: its lane (the
// status property) and its affiliation links.
interface VaultFields {
  status: string;
  affiliation: string[];
}

// Everything the per-item verdict needs beyond the item itself.
interface VerdictContext {
  projectName: string;
  syncedAt: string;
  sections: Record<string, string>;
  defaultLane: string | null;
  doneLane: string;
  hasLanes: boolean;
  // A twin id's note stem, so a remote parent id resolves to the affiliation
  // link a vault note carries.
  stemByTwinId: Map<string, string>;
  // A twin id's entity uuid, so structural comparisons speak the canonical
  // parent representation the base stores.
  uuidByTwinId: Map<string, string>;
}

// UC: apply Todoist -> vault verdicts for anchored items (t5). An anchored item
// is one whose todoist handle is in the registry; the note it mirrors is at
// that record's notePath. On each pass the fetched remote state (the active set
// plus the completed-since window) is compared to the mirror's base per field
// (dt-08), because a hash alone cannot say which field moved:
//
//   - content rename  -> rename the vault note through the existing rename
//                        propagation (checklists relink, bookkeeping follows)
//   - lane (section)  -> rewrite the note's status and move the board card
//                        (top-level tasks only; a subtask inherits its parent's
//                        section, dt-02)
//   - parent change   -> rewrite the note's affiliation
//
// A field changed on both sides is a conflict: the vault wins (dt-01), so the
// remote value is not applied and the projection re-pushes the vault state on
// this tick; the base is re-stamped either way so the next poll does not
// re-trigger. Completion and reopen (a twin completed, or active again while
// its base says completed) are owned by ApplyTodoistCompletionAction (t4) and
// are not revisited here. A twin absent from both the active set and the
// completed window is a Todoist-side deletion when its note survives (t6): the
// record is evicted so the projection re-creates the twin in the same tick
// (vault wins); a missing note is left to PropagateTodoistDeletionsAction.
export class ApplyTodoistRemoteChangesAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly propagateStatus: PropagateStatusAction,
    private readonly relocateTaskStatus: RelocateTaskStatusAction,
    private readonly relinkRenamedTodo: RelinkRenamedTodoAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: ApplyTodoistRemoteChangesInput): Promise<void> {
    const projectState = await this.syncState.getTodoistProjectState(
      input.projectName,
    );
    const sections = projectState?.sections ?? {};
    const since = projectState?.lastCompletedPoll || input.syncedAt;

    // Both fetches must succeed before any vault write.
    const completed = await this.taskManager.fetchCompletedTasks(
      input.projectId,
      since,
    );
    const active = await this.taskManager.fetchActiveTasks(input.projectId);
    const twinById = new Map<string, TodoistTaskData>();
    // Completed first, then active, so a reopened twin reads as active.
    for (const twin of completed) {
      twinById.set(twin.id, twin);
    }
    for (const twin of active) {
      twinById.set(twin.id, twin);
    }

    const identity = await this.syncState.getIdentity(input.projectName);
    const hasLanes = (identity?.statusOptions.length ?? 0) > 0;
    const defaultLane = identity?.statusOptions[0]?.name ?? null;

    const records = (await this.syncState.list()).filter(
      (record) =>
        isMirroredPath(record.notePath, input.projectName) &&
        record.mirrors.todoist !== undefined,
    );
    const stemByTwinId = new Map<string, string>();
    const uuidByTwinId = new Map<string, string>();
    for (const record of records) {
      const handle = record.mirrors.todoist?.handle ?? '';
      if (handle === '') {
        continue;
      }
      stemByTwinId.set(handle, stemOf(record.notePath));
      uuidByTwinId.set(handle, record.id);
    }

    const context: VerdictContext = {
      projectName: input.projectName,
      syncedAt: input.syncedAt,
      sections,
      defaultLane,
      doneLane: this.doneOptionName,
      hasLanes,
      stemByTwinId,
      uuidByTwinId,
    };

    for (const record of records) {
      const handle = record.mirrors.todoist?.handle ?? '';
      const twin = twinById.get(handle);
      if (!twin) {
        // Absent from both the active set and the completed-since window. A
        // completed twin naturally ages out of that window and is never in the
        // active set, so a completed base says it is a persisted completed
        // twin, not a deletion. Evicting it would re-create the twin every
        // tick — the dt-17 churn — so a completed record is left untouched.
        if (baseDone(record)) {
          continue;
        }
        // A missing note is a vault deletion (PropagateTodoistDeletionsAction
        // owns it, later in the same tick). When the note survives, the twin
        // was deleted on the Todoist side: the vault wins, so the record is
        // evicted and the projection re-creates the twin later in this same
        // tick — the self-heal.
        if (await this.vault.getNoteByPath(record.notePath)) {
          await this.syncState.remove(record.id);
        }
        continue;
      }
      // Completion and reopen are the completion action's (t4): a completed
      // twin, or an active twin whose base says completed, is skipped here.
      if (twin.isCompleted || baseDone(record)) {
        continue;
      }
      await this.applyVerdict(record, twin, context);
    }
  }

  private async applyVerdict(
    record: EntityRecord,
    twin: TodoistTaskData,
    context: VerdictContext,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(record.notePath);
    if (!note) {
      return;
    }
    const fields = readVaultFields(note.content);
    if (!fields) {
      return;
    }

    const base = record.mirrors.todoist?.base ?? null;
    const isTask = isTaskPath(record.notePath, context.projectName);
    // A top-level task's lane is its section; a subtask inherits its parent's
    // section (dt-02), so its lane is not a controlled field.
    const topLevel = twin.parentId === null;
    const laneControlled = isTask && topLevel && context.hasLanes;
    // The lane the twin actually sits in. A completed twin never reaches here
    // (the completion action owns it), so the lane is its section.
    const remoteLane = laneControlled
      ? (laneForSection(context.sections, twin.sectionId) ?? context.defaultLane)
      : null;
    const remoteParent = parentUuid(context, twin.parentId);

    // The canonical base: the stored diff view's content. An empty status is
    // the canonical encoding for "lane not controlled" (a to-do or a subtask);
    // a null parent is a top-level item.
    const baseContent = base?.title ?? '';
    const baseLane = base?.status === undefined || base.status === '' ? null : base.status;
    const baseParent = base?.parent ?? null;

    const contentChanged = twin.content !== baseContent;
    // Only a lane-controlled item (a top-level task with lanes) has a lane to
    // compare; a to-do or subtask carries the open/completed vocabulary in its
    // base, which is not a lane, so comparing it would restamp the base every
    // pass (the projection writes 'open'/'completed' there).
    const laneChanged =
      laneControlled && baseLane !== null && remoteLane !== baseLane;
    const parentChanged = remoteParent !== baseParent;

    const vaultLane = laneControlled ? fields.status : null;
    const vaultParent = parentUuidFromAffiliation(fields.affiliation, context, isTask);
    const localContentChanged =
      slugify(baseContent) !== stemWithoutId(record.notePath);
    const localLaneChanged = baseLane !== null && vaultLane !== baseLane;
    // An unresolved parent link (its twin has no anchored note) is unknown, not
    // a change: comparing it would read every unanchored parent as a vault edit.
    const localParentChanged =
      vaultParent !== undefined && vaultParent !== baseParent;

    const remoteChanged = contentChanged || laneChanged || parentChanged;
    const localChanged =
      localContentChanged || localLaneChanged || localParentChanged;

    if (remoteChanged && localChanged) {
      // The vault wins: leave the note alone and re-stamp from the remote, so
      // the next poll reads it as settled. The projection re-pushes the vault
      // state later in this same tick.
      await this.stamp(record, twin, remoteLane, remoteParent);
      return;
    }

    if (remoteChanged) {
      let notePath = record.notePath;
      if (contentChanged) {
        notePath = await this.renameNote(notePath, twin, isTask, context);
      }
      if (laneChanged && remoteLane !== null) {
        await this.applyLane(notePath, remoteLane, record, context);
      }
      if (parentChanged) {
        await this.applyParent(notePath, twin.parentId, context, isTask);
      }
      await this.stamp(record, twin, remoteLane, remoteParent);
    }
  }

  // Renames the note to follow the remote content, then propagates the rename
  // through the existing machinery: a task note moves its registry record, a
  // to-do relinks its parent checklist line. Returns the new path.
  private async renameNote(
    oldPath: string,
    twin: TodoistTaskData,
    isTask: boolean,
    context: VerdictContext,
  ): Promise<string> {
    const newPath = isTask
      ? taskRenameTarget(context.projectName, oldPath, twin.content)
      : `Projecten/${context.projectName}/todos/${slugify(twin.content)}.md`;
    if (newPath === oldPath) {
      return oldPath;
    }

    await this.vault.renameNote(oldPath, newPath);
    if (isTask) {
      await this.relocateTaskStatus.execute({ oldPath, newPath });
    } else {
      await this.relinkRenamedTodo.execute({
        oldPath,
        newPath,
        syncedAt: context.syncedAt,
      });
    }
    return newPath;
  }

  // A remote lane drag: rewrite the note's status, then mirror the move onto
  // GitHub. An issue-backed note propagates its status (issue state + board
  // card + baseline); a captured draft has no github handle, so only the note
  // moves.
  private async applyLane(
    notePath: string,
    lane: string,
    record: EntityRecord,
    context: VerdictContext,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(notePath);
    if (!note) {
      return;
    }
    await this.vault.writeNote(notePath, withStatus(note.content, lane));

    const url = record.mirrors.github?.handle ?? '';
    if (url !== '') {
      await this.propagateStatus.execute({
        url,
        statusName: lane,
        notePath,
        projectName: context.projectName,
      });
    }
  }

  // A remote parent change: rewrite the note's affiliation. A task gains the
  // slice it was dragged under, or drops it when dragged back to top level. A
  // to-do's parent drag is not applied — the vault stays the source of truth
  // for to-do structure and the projection re-pushes it.
  private async applyParent(
    notePath: string,
    remoteParentTwin: string | null,
    context: VerdictContext,
    isTask: boolean,
  ): Promise<void> {
    if (!isTask) {
      return;
    }
    let parentLink: string | null = null;
    if (remoteParentTwin !== null) {
      parentLink = context.stemByTwinId.get(remoteParentTwin) ?? null;
      // The parent has no anchored note yet; wait for the next tick.
      if (parentLink === null) {
        return;
      }
    }

    const note = await this.vault.getNoteByPath(notePath);
    if (!note) {
      return;
    }

    // The gate IS the diff: the note's current affiliation already names the
    // desired parent, so the rewrite is skipped. This keeps a note whose
    // affiliation was just rewritten (by the capture pass or the projection)
    // out of a redundant write.
    const currentLinks = parseAffiliation(
      splitFrontmatter(note.content)?.fields.get('affiliation'),
    )
      .map(stripLink)
      .filter((target) => target !== context.projectName);
    const currentParent = currentLinks[0] ?? null;
    if (currentParent === parentLink) {
      return;
    }

    const links = [`[[${context.projectName}]]`];
    if (parentLink !== null) {
      links.push(`[[${parentLink}]]`);
    }
    const value = `[${links.map((link) => `"${link}"`).join(', ')}]`;
    await this.vault.writeNote(notePath, withAffiliation(note.content, value));
  }

  // Writes the todoist mirror's base as a diff view. The base is what the next
  // poll compares against, so stamping it here settles the item.
  private async stamp(
    record: EntityRecord,
    twin: TodoistTaskData,
    remoteLane: string | null,
    remoteParent: string | null,
  ): Promise<void> {
    const previous = record.mirrors.todoist?.base ?? null;
    const view = toDiffViewWithBody(
      new TaskData(
        record.id,
        record.notePath,
        {}, // bases carry no handles
        twin.content,
        '', // the Todoist description is not vault content
        remoteLane ?? '',
        // Completion is the completion action's field (t4); this action never
        // handles a completed twin, so the base's completion stays clear.
        null,
        '', // the vault-owned type never rides a Todoist base
        remoteParent,
        previous?.createdAt ?? null,
        twin.updatedAt || null,
      ),
    );
    const mirrors = {
      ...record.mirrors,
      todoist: new Mirror(record.mirrors.todoist?.handle ?? '', view),
    };
    await this.syncState.set({
      id: record.id,
      notePath: record.notePath,
      mirrors,
    });
  }
}

// The entity uuid a parent twin id names, or null for a top-level item. Used so
// the canonical base's parent is a uuid on both sides.
function parentUuid(context: VerdictContext, twinId: string | null): string | null {
  if (twinId === null) {
    return null;
  }
  return context.uuidByTwinId.get(twinId) ?? null;
}

// The parent entity uuid a note's affiliation implies. A task's first
// non-project link is its slice; a to-do's second is its parent to-do when
// nested, else its task. Returns null when the note has no parent link, and
// undefined when it has one whose twin has no anchored note (unknown — not a
// change).
function parentUuidFromAffiliation(
  affiliation: string[],
  context: VerdictContext,
  isTask: boolean,
): string | null | undefined {
  const targets = affiliation
    .map(stripLink)
    .filter((target) => target !== context.projectName);
  const parentLink = isTask ? targets[0] : (targets[1] ?? targets[0]);
  if (parentLink === undefined) {
    return null;
  }
  const twinId = context.stemByTwinId.get(parentLink);
  if (twinId === undefined) {
    return undefined;
  }
  return context.uuidByTwinId.get(twinId) ?? undefined;
}

// A task note's rename target: the project's taken folder, keeping any leading
// `<remoteId>-` prefix an issue-backed note carries (a captured draft has none).
function taskRenameTarget(
  projectName: string,
  oldPath: string,
  content: string,
): string {
  const prefix = stemOf(oldPath).match(/^(\d+)-/)?.[1];
  const stem =
    prefix === undefined ? slugify(content) : `${prefix}-${slugify(content)}`;
  return `Projecten/${projectName}/taken/${stem}.md`;
}

// Rewrites just the affiliation line of a note, preserving every other field
// and the body. Mirrors withStatus for task notes.
function withAffiliation(content: string, value: string): string {
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
    new Map([['affiliation', value]]),
  );
  return [...frontmatter, ...lines.slice(closing + 1)].join('\n');
}

function readVaultFields(content: string): VaultFields | null {
  const split = splitFrontmatter(content);
  if (!split) {
    return null;
  }
  const status = split.fields.get('status');
  if (status === undefined) {
    return null;
  }
  return {
    status,
    affiliation: parseAffiliation(split.fields.get('affiliation')),
  };
}

// The stem with an issue note's leading `<remoteId>-` prefix stripped, so it
// compares to the slug of a title.
function stemWithoutId(path: string): string {
  return stemOf(path).replace(/^\d+-/, '');
}

function isTaskPath(path: string, projectName: string): boolean {
  return path.startsWith(`Projecten/${projectName}/taken/`);
}

// Whether the record's todoist base already records the item as completed.
function baseDone(record: EntityRecord): boolean {
  const base = record.mirrors.todoist?.base ?? null;
  return base !== null && base.completedAt !== null;
}
