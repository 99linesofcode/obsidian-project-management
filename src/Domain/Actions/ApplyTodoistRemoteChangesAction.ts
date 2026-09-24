import { fillFrontmatterFields } from '../Notes/fillFrontmatterFields.js';
import { hash } from '../Notes/hash.js';
import { parseAffiliation } from '../Notes/parseAffiliation.js';
import { slugify } from '../Notes/TaskNoteMapper.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { withStatus } from '../Notes/TaskNoteParser.js';
import type { TodoistStateData } from '../DataTransferObjects/TodoistStateData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
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
}

// UC: apply Todoist -> vault verdicts for anchored items (t5). An anchored item
// is one whose id is in the TodoistState bookkeeping; the note it mirrors is at
// that record's notePath. On each pass the fetched remote state (the active set
// plus the completed-since window) is compared to the stored snapshot per
// field (dt-08), because a hash alone cannot say which field moved:
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
// this tick; the snapshot is re-stamped either way so the next poll does not
// re-trigger. A task twin that is active again while the snapshot says completed
// is a remote reopen (t7): the same signal t4 uses for to-dos, extended to
// tasks. The twin's section is the done section (the projection moved it there
// when it completed), so the section cannot name the lane to return to; the
// reopen pulls the note out of done into the default lane and propagates the
// status, which reopens the issue and moves the board card. To-do completion and
// reopen stay owned by ApplyTodoistCompletionAction (t4) and are not revisited
// here. A twin absent from both the active set and the completed window is a
// Todoist-side deletion when its note survives (t6): the record is evicted so
// the projection re-creates the twin in the same tick (vault wins); a missing
// note is left to PropagateTodoistDeletionsAction.
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

    const states = (await this.syncState.listTodoistStates()).filter((state) =>
      isMirroredPath(state.notePath, input.projectName),
    );
    const stemByTwinId = new Map<string, string>();
    for (const state of states) {
      stemByTwinId.set(state.todoistId, stemOf(state.notePath));
    }

    const context: VerdictContext = {
      projectName: input.projectName,
      syncedAt: input.syncedAt,
      sections,
      defaultLane,
      doneLane: this.doneOptionName,
      hasLanes,
      stemByTwinId,
    };

    for (const state of states) {
      const twin = twinById.get(state.todoistId);
      if (!twin) {
        // Absent from both the active set and the completed-since window. A
        // missing note is a vault deletion (PropagateTodoistDeletionsAction
        // owns it, later in the same tick). When the note survives, the twin
        // was deleted on the Todoist side: that is not a vault deletion and not
        // a completion (a completion would be in the completed window). The
        // vault wins, so the record is evicted and the projection re-creates
        // the twin later in this same tick — the self-heal.
        if (await this.vault.getNoteByPath(state.notePath)) {
          await this.syncState.removeTodoistState(state.notePath);
        }
        continue;
      }
      await this.applyVerdict(state, twin, context);
    }
  }

  private async applyVerdict(
    state: TodoistStateData,
    twin: TodoistTaskData,
    context: VerdictContext,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(state.notePath);
    if (!note) {
      return;
    }
    const fields = readVaultFields(note.content);
    if (!fields) {
      return;
    }

    const isTask = isTaskPath(state.notePath, context.projectName);
    // A top-level task's lane is its section; a subtask inherits its parent's
    // section (dt-02), so its lane is not a controlled field.
    const topLevel = twin.parentId === null;
    const laneControlled = isTask && topLevel && context.hasLanes;
    // A task twin that is active while the snapshot says completed is a remote
    // reopen (t7). The twin's section is the done section (the projection moved
    // it there when it completed), so the section cannot name the lane to return
    // to; the reopen returns the note to the default lane. A project without
    // lanes has no lane to return to, so there is nothing to pull out of done.
    const reopened =
      isTask &&
      state.lastSyncedCompleted === true &&
      !twin.isCompleted &&
      context.defaultLane !== null;
    // A completed top-level item is in the done lane regardless of its section
    // (dt-07: is_completed ⇔ done lane); a section-less open item lands in the
    // default lane. This is the lane the twin actually sits in, which is what
    // the snapshot records; a reopen is a separate signal below.
    const remoteLane = laneControlled
      ? twin.isCompleted
        ? context.doneLane
        : (laneForSection(context.sections, twin.sectionId) ??
          context.defaultLane)
      : null;

    const baseContent = state.lastSyncedContent;
    const baseLane = state.lastSyncedLane;
    const baseParent = state.lastSyncedParent;

    const contentChanged =
      baseContent !== undefined && twin.content !== baseContent;
    const laneChanged =
      baseLane !== undefined && remoteLane !== (baseLane ?? null);
    const parentChanged =
      baseParent !== undefined && twin.parentId !== (baseParent ?? null);

    const vaultLane = laneControlled ? fields.status : null;
    const vaultParent = parentIdFromAffiliation(
      fields.affiliation,
      context,
      isTask,
    );
    const localContentChanged =
      baseContent !== undefined &&
      slugify(baseContent) !== stemWithoutId(state.notePath);
    const localLaneChanged =
      baseLane !== undefined && vaultLane !== (baseLane ?? null);
    // An unresolved parent link (its twin has no anchored note) is unknown, not
    // a change: comparing it would read every unanchored parent as a vault edit.
    const localParentChanged =
      baseParent !== undefined &&
      vaultParent !== undefined &&
      vaultParent !== (baseParent ?? null);

    const remoteChanged =
      contentChanged || laneChanged || parentChanged || reopened;
    const localChanged =
      localContentChanged || localLaneChanged || localParentChanged;

    // For a task the completion base is the twin's own state: the completion
    // action owns only to-dos, so a task's base must follow the twin or a
    // reopen would never settle. For a to-do it is preserved, so a remote
    // completion racing a rename is not mistaken for our own echo (t4).
    const completedBase = isTask ? twin.isCompleted : state.lastSyncedCompleted;

    if (remoteChanged && localChanged) {
      // The vault wins: leave the note alone and re-stamp from the remote, so
      // the next poll reads it as settled. The projection re-pushes the vault
      // state later in this same tick.
      await this.stamp(state.notePath, twin, remoteLane, completedBase);
      return;
    }

    if (remoteChanged) {
      let notePath = state.notePath;
      if (contentChanged) {
        notePath = await this.renameNote(notePath, twin, isTask, context);
      }
      if (reopened) {
        // The reopen is a lane move out of done; it takes precedence over the
        // section-derived lane, which still reads as done.
        await this.applyLane(notePath, context.defaultLane!, context);
      } else if (laneChanged && remoteLane !== null) {
        await this.applyLane(notePath, remoteLane, context);
      }
      if (parentChanged) {
        await this.applyParent(notePath, twin.parentId, context, isTask);
      }
      await this.stamp(notePath, twin, remoteLane, completedBase);
      return;
    }

    // Nothing changed remotely: fill any missing per-field base so a later
    // remote change can be told from a vault change.
    if (
      baseContent === undefined ||
      baseLane === undefined ||
      baseParent === undefined
    ) {
      await this.stamp(state.notePath, twin, remoteLane, completedBase);
    }
  }

  // Renames the note to follow the remote content, then propagates the rename
  // through the existing machinery: a task note moves its Status/bookkeeping
  // record, a to-do relinks its parent checklist line. Returns the new path.
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
  // card + baseline); a captured draft has no issue, so only the note moves.
  private async applyLane(
    notePath: string,
    lane: string,
    context: VerdictContext,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(notePath);
    if (!note) {
      return;
    }
    await this.vault.writeNote(notePath, withStatus(note.content, lane));

    const url = splitFrontmatter(note.content)?.fields.get('url') ?? '';
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
    remoteParent: string | null,
    context: VerdictContext,
    isTask: boolean,
  ): Promise<void> {
    if (!isTask) {
      return;
    }
    let parentLink: string | null = null;
    if (remoteParent !== null) {
      parentLink = context.stemByTwinId.get(remoteParent) ?? null;
      // The parent has no anchored note yet; wait for the next tick.
      if (parentLink === null) {
        return;
      }
    }

    const note = await this.vault.getNoteByPath(notePath);
    if (!note) {
      return;
    }
    const links = [`[[${context.projectName}]]`];
    if (parentLink !== null) {
      links.push(`[[${parentLink}]]`);
    }
    const value = `[${links.map((link) => `"${link}"`).join(', ')}]`;
    await this.vault.writeNote(notePath, withAffiliation(note.content, value));
  }

  private async stamp(
    notePath: string,
    twin: TodoistTaskData,
    remoteLane: string | null,
    lastSyncedCompleted: boolean,
  ): Promise<void> {
    await this.syncState.setTodoistState(notePath, {
      todoistId: twin.id,
      notePath,
      lastSyncedHash: remoteSnapshotHash(twin, remoteLane !== null),
      // The completion base belongs to the completion action (t4): preserve it
      // rather than restamping from the twin, or a remote completion racing a
      // content change would read as our own echo and never be applied.
      lastSyncedCompleted,
      lastSyncedContent: twin.content,
      lastSyncedLane: remoteLane,
      lastSyncedParent: twin.parentId,
    });
  }
}

// The snapshot hash (dt-08): content, labels, section, parent and completion.
// The section enters only for a top-level item (a subtask inherits its parent's
// section, dt-02), matching the projection's desired-shape hash.
function remoteSnapshotHash(twin: TodoistTaskData, topLevel: boolean): string {
  return hash(
    [
      twin.content,
      [...twin.labels].sort().join(','),
      topLevel ? (twin.sectionId ?? '') : '',
      twin.parentId ?? '',
      twin.isCompleted ? '1' : '0',
    ].join('\n'),
  );
}

// The lane whose section id is the given id, or null when the id is not a lane
// section (a section-less item, or a section outside the lane map).
function laneForSection(
  sections: Record<string, string>,
  sectionId: string | null,
): string | null {
  if (sectionId === null) {
    return null;
  }
  for (const [lane, id] of Object.entries(sections)) {
    if (id === sectionId) {
      return lane;
    }
  }
  return null;
}

// The parent twin id a note's affiliation implies. A task's first non-project
// link is its slice; a to-do's second is its parent to-do when nested, else its
// task. Returns null when the note has no parent link, and undefined when it
// has one whose twin has no anchored note (unknown — not a change).
function parentIdFromAffiliation(
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
  return context.stemByTwinId.get(parentLink);
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

function stripLink(link: string): string {
  return link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.trim();
}

// A note's filename stem: its basename without the .md extension.
function stemOf(path: string): string {
  const basename = path.split('/').pop() ?? '';
  return basename.replace(/\.md$/, '');
}

// The stem with an issue note's leading `<remoteId>-` prefix stripped, so it
// compares to the slug of a title.
function stemWithoutId(path: string): string {
  return stemOf(path).replace(/^\d+-/, '');
}

function isTaskPath(path: string, projectName: string): boolean {
  return path.startsWith(`Projecten/${projectName}/taken/`);
}

function isMirroredPath(path: string, projectName: string): boolean {
  return (
    isTaskPath(path, projectName) ||
    path.startsWith(`Projecten/${projectName}/todos/`)
  );
}
