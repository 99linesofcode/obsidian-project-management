import { laneForSection } from '../Board/laneForSection.js';
import { TaskData } from '../DataTransferObjects/TaskData.js';
import { ToDoData } from '../DataTransferObjects/ToDoData.js';
import { hasTypeLabel } from '../Labels/hasTypeLabel.js';
import { TodoistTaskMapper } from '../Mappers/TodoistTaskMapper.js';
import { parseChecklist } from '../Notes/Checklist.js';
import { hash } from '../Notes/hash.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stemOf } from '../Notes/stemOf.js';
import { stripLink } from '../Notes/stripLink.js';
import { taskLinkFromAffiliation } from '../Notes/taskLinkFromAffiliation.js';
import { TaskNoteParser } from '../Notes/TaskNoteParser.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import type { ConflictHints } from '../Reconciliation/VerdictResolver.js';
import { VerdictResolver } from '../Reconciliation/VerdictResolver.js';
import type {
  DimensionVerdict,
  SyncVerdict,
} from '../Reconciliation/SyncVerdict.js';
import type { EntityRecord, SyncStatePort } from '../Ports/SyncStatePort.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { TodoistSectionData } from '../DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { ApplyTaskToTodoistAction } from './ApplyTaskToTodoistAction.js';
import type { ApplyTodoistCompletionAction } from './ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from './ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from './CaptureTodoistCreationsAction.js';
import type { EnsureTodoistSectionsAction } from './EnsureTodoistSectionsAction.js';
import type { PropagateTodoistDeletionsAction } from './PropagateTodoistDeletionsAction.js';

export interface SyncTodoistTasksInput {
  projectName: string;
  // The resolved Todoist project id from the chain's lifecycle verdict.
  projectId: string;
  syncedAt: string;
}

// One tracked issue resolved to its vault note and registry record: the issue
// carries the type label and the title, the note carries the lane (its status)
// and the slice affiliation.
interface ProjectionItem {
  issue: { url: string; title: string; labels: string[] };
  record: EntityRecord;
  notePath: string;
  noteContent: string;
  type: string;
  lane: string;
  sliceLink: string | null;
  // The todoist mirror handle and base, resolved from the registry's port
  // items because the entity no longer carries them.
  handle: string | null;
  base: TaskData | null;
}

// One to-do linked from a tracked task's checklist, resolved to its note and
// the task note that owns it.
interface ToDoItem {
  notePath: string;
  noteContent: string;
  title: string;
  // The parent task's note path; its twin is resolved from the pass's task
  // projection (or the registry), never from a stale note anchor.
  taskNotePath: string;
  // The parent to-do's note stem when this to-do nests under another to-do
  // (Todoist indent level 4 — the ceiling); null for a direct task child.
  parentStem: string | null;
}

// The Todoist half on the registry: fetch the project's items (the fetch IS the
// probe — Todoist REST v1 has no conditional request), resolve each item's
// entity record by its todoist mirror handle, compose the remote and vault
// canonical live views, diff them per field against the mirror's base, and
// apply the winning side through ApplyTaskToTodoistAction. The remote -> vault
// absorption (ApplyTodoistRemoteChanges + ApplyTodoistCompletion) runs first
// and stays retained. Captured creations (dt-06) and deletion propagation close
// the half.
//
// Identity always comes from the registry, never from the fetch or a note
// anchor: the mapper leaves id/notePath empty and this action composes them
// from the record. All diffing operates on diff views (body = digest, type
// excluded — the vault-owned type never rides a Todoist base); base storage is
// a diff view.
export class SyncTodoistTasksAction {
  private readonly verdictResolver: VerdictResolver;

  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly ensureSections: EnsureTodoistSectionsAction,
    private readonly applyToTodoist: ApplyTaskToTodoistAction,
    private readonly applyTodoistRemoteChanges: ApplyTodoistRemoteChangesAction,
    private readonly captureTodoistCreations: CaptureTodoistCreationsAction,
    private readonly applyTodoistCompletion: ApplyTodoistCompletionAction,
    private readonly propagateTodoistDeletions: PropagateTodoistDeletionsAction,
    private readonly doneOptionName: string,
  ) {
    this.verdictResolver = new VerdictResolver(doneOptionName);
  }

  async execute(input: SyncTodoistTasksInput): Promise<void> {
    try {
      // Remote -> vault first: a remote change is never clobbered by a
      // vault-side push. Both absorbers are retained (see the class comment).
      // Capture runs before the completion pass: it reads the completed-since
      // window from the stored cursor, which ApplyTodoistCompletion advances.
      await this.applyTodoistRemoteChanges.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });
      await this.captureTodoistCreations.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });
      await this.applyTodoistCompletion.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });

      // The probe: one active-task fetch serves both projections.
      const active = await this.taskManager.fetchActiveTasks(input.projectId);
      // The pass-level twin plan: projectTasks creates every top-level twin
      // first (phase A) and returns note-path -> twin-id for the whole tree, so
      // projectToDos can hang each to-do off a parent that exists in this pass
      // (phase B) instead of a possibly-stale note anchor.
      const taskTwinIdByNotePath = await this.projectTasks(input, active);
      await this.projectToDos(input, active, taskTwinIdByNotePath);

      // Deletions last (spec reconcile step 7).
      await this.propagateTodoistDeletions.execute({
        projectName: input.projectName,
      });
    } catch {
      // A Todoist failure must never break the GitHub half.
    }
  }

  // The vault's tracked tasks projected onto their twins in TWO PHASES. Phase A
  // creates every top-level twin first — a slice's twin and a standalone
  // task's twin are both top-level — so phase B can wire a child to a parent
  // that exists in this very pass. Phase B then creates the slice-member tasks
  // under their slice twin. The returned map (note path -> twin id) is the
  // pass's twin plan; projectToDos hangs each to-do off it.
  private async projectTasks(
    input: SyncTodoistTasksInput,
    active: TodoistTaskData[],
  ): Promise<Map<string, string>> {
    const taskTwinIdByNotePath = new Map<string, string>();
    const identity = await this.syncState.getIdentity(input.projectName);
    // A project without a GitHub attach has no typed issues to project (dt-03).
    if (!identity?.repoUrl) {
      return taskTwinIdByNotePath;
    }

    const portState = await this.syncState.getPortState(
      input.projectName,
      'todoist',
    );
    const storedSections = portState?.lanes ?? {};
    const sections = await this.ensureSections.execute({
      projectId: input.projectId,
      laneNames: identity.statusOptions.map((option) => option.name),
      stored: storedSections,
    });
    // Only rewrite the bookkeeping when the lane map actually moved, so a
    // settled project performs no write at all.
    if (!portState || !sameSections(sections, storedSections)) {
      await this.syncState.setPortState(input.projectName, 'todoist', {
        provider: 'todoist',
        lastPoll: portState?.lastPoll ?? input.syncedAt,
        lanes: sections,
        tags: portState?.tags ?? {},
      });
    }

    const issues = (
      await this.projectManagement.fetchTrackedIssues(identity.repoUrl)
    ).filter((issue) => hasTypeLabel(issue.labels));
    const activeById = new Map(active.map((task) => [task.id, task] as const));
    const todoistByEntity = await this.todoistItems(input.projectName);

    const items: ProjectionItem[] = [];
    for (const issue of issues) {
      // Handle-index resolution: the issue url is the github mirror handle.
      const mirror = await this.syncState.findMirrorItem('github', issue.url);
      const record =
        mirror === null
          ? null
          : await this.syncState.getEntity(mirror.entityId);
      if (!record) {
        continue;
      }
      const note = await this.vault.getNoteByPath(record.notePath);
      if (!note) {
        continue;
      }
      const parsed = TaskNoteParser.parse(note.content);
      if (!parsed) {
        continue;
      }
      const type = typeFromLabels(issue.labels);
      if (type === null) {
        continue;
      }
      const todoist = todoistByEntity.get(record.id);
      items.push({
        issue,
        record,
        notePath: record.notePath,
        noteContent: note.content,
        type,
        lane: parsed.status,
        sliceLink: taskLinkFromAffiliation(
          parsed.affiliation,
          input.projectName,
        ),
        handle: todoist?.handle ?? null,
        base: todoist?.base ?? null,
      });
    }

    const slices = items.filter((item) => item.type === 'slice');
    // A child is any task whose affiliation names a parent — a slice or another
    // task (a GitHub sub-issue of either). The parent's type does not matter:
    // phase B resolves the named parent's twin and hangs the child under it, so
    // placement generalizes from slices to any tracked parent.
    const children = items.filter(
      (item) => item.type !== 'slice' && item.sliceLink !== null,
    );
    const unaffiliated = items.filter(
      (item) => item.type !== 'slice' && item.sliceLink === null,
    );

    // Phase A — every top-level twin. Slices and standalone tasks both sit at
    // the top level; creating them before any child is what lets phase B (and
    // the to-do pass) resolve a real parent id.
    for (const item of slices) {
      const taskId = await this.projectItem(
        item,
        { sectionId: sections[item.lane] ?? null, parentId: null },
        activeById,
        sections,
        input,
      );
      taskTwinIdByNotePath.set(item.notePath, taskId);
    }
    for (const item of unaffiliated) {
      const taskId = await this.projectItem(
        item,
        { sectionId: sections[item.lane] ?? null, parentId: null },
        activeById,
        sections,
        input,
      );
      taskTwinIdByNotePath.set(item.notePath, taskId);
    }

    // Phase B — affiliated tasks attach to the parent twin phase A created (or
    // an existing one the map already carries). The parent is the affiliation
    // link, so a sub-issue of a slice and a sub-issue of a plain task flow the
    // same way.
    for (const item of children) {
      const slicePath = sliceNotePath(input.projectName, item.sliceLink!);
      const parentId =
        taskTwinIdByNotePath.get(slicePath) ??
        (await this.twinIdForPath(slicePath, todoistByEntity));
      if (parentId === null) {
        // The slice has no twin yet; the child waits for the next tick.
        continue;
      }
      const taskId = await this.projectItem(
        item,
        { sectionId: null, parentId },
        activeById,
        sections,
        input,
      );
      taskTwinIdByNotePath.set(item.notePath, taskId);
    }

    return taskTwinIdByNotePath;
  }

  // Projects one task through the canonical pipeline and returns its twin id.
  private async projectItem(
    item: ProjectionItem,
    placement: { sectionId: string | null; parentId: string | null },
    activeById: Map<string, TodoistTaskData>,
    sections: Record<string, string>,
    input: SyncTodoistTasksInput,
  ): Promise<string> {
    const handle = item.handle;
    const current = handle === null ? null : (activeById.get(handle) ?? null);
    const base = item.base;
    const parentUuid = await this.twinUuid(placement.parentId);
    const vault = this.vaultView(item, placement, parentUuid);

    // A missing twin is a membership gap the writer must fill; only a present
    // twin whose remote moved (the absorber's pull) is left to the absorber.
    if (current !== null && handle !== null && base !== null) {
      const remote = this.remoteView(current, item.record, sections, parentUuid);
      const vaultDiff = this.diffView(vault);
      const remoteDiff = this.diffView(remote);
      const verdicts = this.verdictResolver.diff(vaultDiff, remoteDiff, base);
      const resolved = this.verdictResolver.resolveConflicts(
        vaultDiff,
        remoteDiff,
        verdicts,
        await this.conflictHints(current, item.notePath),
      );
      if (overallVerdict(resolved) === 'pull') {
        return handle;
      }
    }

    return this.applyToTodoist.executeTask({
      task: vault,
      current,
      record: item.record,
      handle,
      projectId: input.projectId,
      sectionId: placement.sectionId,
      parentId: placement.parentId,
      labels: [item.type],
      notePath: item.notePath,
      noteContent: item.noteContent,
      syncedAt: input.syncedAt,
    });
  }

  // The vault's to-dos projected onto their twins. Phase B of the pass: every
  // task twin already exists (phase A created the top-level ones, the loop
  // below creates the slice members first), so a root to-do always hangs off a
  // real task twin. A to-do whose parent twin cannot exist is an orphan owned
  // by the vault-consistency pass: it is skipped, never created top-level.
  private async projectToDos(
    input: SyncTodoistTasksInput,
    active: TodoistTaskData[],
    taskTwinIdByNotePath: Map<string, string>,
  ): Promise<void> {
    const items = await this.collectToDos(input.projectName);
    if (items.length === 0) {
      return;
    }
    const activeById = new Map(active.map((task) => [task.id, task] as const));
    const todoistByEntity = await this.todoistItems(input.projectName);

    const roots = items.filter((item) => item.parentStem === null);
    const nested = items.filter((item) => item.parentStem !== null);

    const twinIdByStem = new Map<string, string>();
    for (const item of roots) {
      const parentId = await this.parentTaskTwinId(
        item.taskNotePath,
        taskTwinIdByNotePath,
        todoistByEntity,
      );
      if (parentId === null) {
        // The parent task has no twin and none can exist this pass (it is not a
        // tracked issue and carries no stored record). The to-do is an orphan
        // the vault-consistency pass will trash; creating it top-level is the
        // #61 churn loop, so it is skipped and converges next tick.
        console.error(
          `SyncTodoistTasksAction: to-do ${item.notePath} has no parent twin (${item.taskNotePath}); skipping this tick`,
        );
        continue;
      }
      const id = await this.projectToDoItem(
        item,
        parentId,
        activeById,
        todoistByEntity,
        input,
      );
      twinIdByStem.set(stemOf(item.notePath), id);
    }

    for (const item of nested) {
      const parentId =
        twinIdByStem.get(item.parentStem!) ??
        (await this.twinIdForPath(
          `Projecten/${input.projectName}/todos/${item.parentStem}.md`,
          todoistByEntity,
        ));
      if (parentId === null) {
        // The parent to-do has no twin yet; the child waits for the next tick.
        continue;
      }
      await this.projectToDoItem(
        item,
        parentId,
        activeById,
        todoistByEntity,
        input,
      );
    }
  }

  // The parent task's twin id: the pass's own projection first, so a twin
  // created this pass wins over a stale registry handle, then the registry
  // record for a captured draft task that is not a tracked issue. Null when
  // neither exists — the to-do must not be created.
  private async parentTaskTwinId(
    taskNotePath: string,
    taskTwinIdByNotePath: Map<string, string>,
    todoistByEntity: Map<string, { handle: string; base: TaskData | null }>,
  ): Promise<string | null> {
    const planned = taskTwinIdByNotePath.get(taskNotePath);
    if (planned !== undefined) {
      return planned;
    }
    return await this.twinIdForPath(taskNotePath, todoistByEntity);
  }

  private async projectToDoItem(
    item: ToDoItem,
    parentId: string,
    activeById: Map<string, TodoistTaskData>,
    todoistByEntity: Map<string, { handle: string; base: TaskData | null }>,
    input: SyncTodoistTasksInput,
  ): Promise<string> {
    const parsed = ToDoNoteParser.parse(item.noteContent);
    const record = await this.syncState.findByNotePath(item.notePath);
    const handle =
      record === null ? null : (todoistByEntity.get(record.id)?.handle ?? null);
    const current = handle === null ? null : (activeById.get(handle) ?? null);
    const todo = await this.vaultToDoView(item, parsed, input.projectName);

    return this.applyToTodoist.executeToDo({
      todo,
      current,
      record,
      handle,
      projectId: input.projectId,
      parentId,
      projectName: input.projectName,
      notePath: item.notePath,
      noteContent: item.noteContent,
      syncedAt: input.syncedAt,
    });
  }

  // The vault's desired canonical task: the issue title, the note's lane and
  // the lane-derived completion. The vault is the source of truth; the issue
  // supplies the title and the type. The parent is the resolved uuid, matching
  // the base's canonical representation.
  private vaultView(
    item: ProjectionItem,
    placement: { sectionId: string | null; parentId: string | null },
    parentUuid: string | null,
  ): TaskData {
    // The lane is controlled only for a top-level task (a subtask inherits its
    // parent's section, dt-02), so a subtask's canonical lane is ''.
    const lane = placement.parentId === null ? item.lane : '';
    const done = lane !== '' && lane === this.doneOptionName;
    return new TaskData(
      item.record.id,
      item.notePath,
      {}, // the vault live view knows no mirror handles
      item.issue.title,
      '', // the Todoist description is not vault content
      lane,
      done ? '' : null,
      item.type,
      parentUuid,
      null,
      null,
    );
  }

  // The remote twin as a canonical live view, with identity composed from the
  // registry record and the parent resolved to its uuid.
  private remoteView(
    twin: TodoistTaskData,
    record: EntityRecord,
    sections: Record<string, string>,
    parentUuid: string | null,
  ): TaskData {
    const section: TodoistSectionData = {
      id: twin.sectionId ?? '',
      projectId: twin.projectId,
      name: laneForSection(sections, twin.sectionId) ?? '',
    };
    const parsed = TodoistTaskMapper.parseTask(twin, section, null);
    const lane = twin.parentId === null ? parsed.status : '';
    const done = twin.isCompleted;
    return new TaskData(
      record.id,
      record.notePath,
      { todoist: twin.id },
      parsed.title,
      '', // the Todoist description is not vault content
      lane,
      done ? (twin.completedAt ?? '') : null,
      parsed.type,
      parentUuid,
      parsed.createdAt,
      parsed.updatedAt,
    );
  }

  // The vault's canonical to-do live view: title, status and the resolved
  // parent/task uuids. The writer's field gate is authoritative for to-dos, so
  // this view is composed but not diffed.
  private async vaultToDoView(
    item: ToDoItem,
    parsed: { status: string; completed: string | null } | null,
    projectName: string,
  ): Promise<ToDoData> {
    const task = await this.syncState.findByNotePath(item.taskNotePath);
    const parentTodo =
      item.parentStem === null
        ? null
        : await this.syncState.findByNotePath(
            `Projecten/${projectName}/todos/${item.parentStem}.md`,
          );
    return new ToDoData(
      (await this.syncState.findByNotePath(item.notePath))?.id ?? '',
      item.notePath,
      {},
      item.title,
      parsed?.status === 'completed' ? 'completed' : 'open',
      parsed?.status === 'completed' ? (parsed.completed ?? '') : null,
      parentTodo?.id ?? null,
      task?.id ?? null,
      null,
      null,
    );
  }

  // The comparable shape the diff reads: the body is the digest of the empty
  // comparable body (the Todoist description is not vault content), and the
  // type is excluded — the vault-owned type never rides a Todoist base.
  private diffView(task: TaskData): TaskData {
    return new TaskData(
      task.id,
      task.notePath,
      {},
      task.title,
      hash(''),
      task.status,
      task.completedAt,
      '',
      task.parent,
      task.createdAt,
      task.updatedAt,
    );
  }

  // The timing evidence the conflict ladder may use: the note's real mtime and
  // Todoist's honest task-scoped content clock. completedAt stamps the
  // completion.
  private async conflictHints(
    twin: TodoistTaskData,
    notePath: string,
  ): Promise<ConflictHints> {
    const updated = twin.updatedAt || null;
    return {
      vaultModifiedAt: await this.vault.modifiedTime(notePath),
      remoteFieldTimes: {
        title: updated,
        body: updated,
        status: updated,
        completedAt: twin.completedAt,
      },
    };
  }

  // Every to-do linked from a task note's checklist, keyed by the task note
  // that owns it. The anchor is deliberately NOT read here: a to-do's parent
  // twin is resolved from the pass's task projection, so a task whose registry
  // record was lost still gets its to-dos hung off the twin this pass creates.
  // De-duplicated by to-do note path.
  private async collectToDos(projectName: string): Promise<ToDoItem[]> {
    const items = new Map<string, ToDoItem>();
    const folder = `Projecten/${projectName}/taken`;

    for (const taskPath of await this.vault.listNotesInFolder(folder)) {
      const task = await this.vault.getNoteByPath(taskPath);
      if (!task) {
        continue;
      }
      const body = splitFrontmatter(task.content)?.body ?? task.content;
      for (const entry of parseChecklist(body)) {
        if (entry.linkPath === undefined) {
          continue;
        }
        // The checklist link is not the identity: a legacy bare wikilink lost
        // its folder, and a leftover file at the bare stem is not the to-do.
        // Resolve it to the project's to-do folder so the note's real path keys
        // the record and anchors the twin.
        const notePath = await this.resolveToDoPath(
          entry.linkPath,
          projectName,
        );
        if (notePath === null) {
          continue;
        }
        const todo = await this.vault.getNoteByPath(notePath);
        if (!todo) {
          continue;
        }
        const parsed = ToDoNoteParser.parse(todo.content);
        if (!parsed) {
          continue;
        }
        items.set(notePath, {
          notePath,
          noteContent: todo.content,
          title: entry.text,
          taskNotePath: taskPath,
          parentStem: parentStemFromAffiliation(
            parsed.affiliation,
            projectName,
          ),
        });
      }
    }

    return [...items.values()];
  }

  // The to-do note a checklist link names. A link already inside the project's
  // to-do folder is its real path; anything else — a legacy bare wikilink above
  // all — is resolved there by stem. A note at the bare stem outside the folder
  // is never the to-do, so it can never key the record or anchor the twin.
  private async resolveToDoPath(
    linkPath: string,
    projectName: string,
  ): Promise<string | null> {
    const folder = `Projecten/${projectName}/todos/`;
    const candidate =
      linkPath.startsWith(folder) && linkPath.endsWith('.md')
        ? linkPath
        : `${folder}${stemOf(linkPath)}.md`;
    return (await this.vault.getNoteByPath(candidate)) === null
      ? null
      : candidate;
  }

  // The project's todoist items keyed by hub entity, so a record's handle and
  // base resolve without the entity carrying them.
  private async todoistItems(
    projectName: string,
  ): Promise<Map<string, { handle: string; base: TaskData | null }>> {
    const result = new Map<string, { handle: string; base: TaskData | null }>();
    for (const { handle, item } of await this.syncState.listMirrorItems(
      projectName,
      'todoist',
    )) {
      result.set(item.entityId, { handle, base: item.base });
    }
    return result;
  }

  // The todoist handle of the record at a note path, or null when the note has
  // no mirror yet. The registry is the anchor now, not the note's frontmatter.
  private async twinIdForPath(
    notePath: string,
    todoistByEntity: Map<string, { handle: string; base: TaskData | null }>,
  ): Promise<string | null> {
    const record = await this.syncState.findByNotePath(notePath);
    return record === null
      ? null
      : (todoistByEntity.get(record.id)?.handle ?? null);
  }

  // The entity uuid a twin id names, or null for a top-level item / an
  // unanchored parent.
  private async twinUuid(twinId: string | null): Promise<string | null> {
    if (twinId === null) {
      return null;
    }
    return (
      (await this.syncState.findMirrorItem('todoist', twinId))?.entityId ?? null
    );
  }
}

// The type a tracked issue carries: the `type: ` prefix is stripped (dt-09).
function typeFromLabels(labels: string[]): string | null {
  const label = labels.find((candidate) => candidate.startsWith('type:'));
  if (label === undefined) {
    return null;
  }
  return label.slice('type:'.length).trim();
}

// A slice link is a note stem; the slice note lives in the project's taken
// folder beside its children.
function sliceNotePath(projectName: string, link: string): string {
  return `Projecten/${projectName}/taken/${stemOf(link)}.md`;
}

// The affiliation lists the project first, then the parent task, then — when
// nested — the parent to-do. The second non-project link is the parent to-do's
// stem; a to-do with no parent link returns null.
function parentStemFromAffiliation(
  affiliation: string[],
  projectName: string,
): string | null {
  const targets = affiliation
    .map(stripLink)
    .filter((target) => target !== projectName);
  return targets[1] ?? null;
}

// Collapses the per-field verdicts into the one direction the writer can apply.
// A vault push takes precedence over a pull (origin authority); after
// resolveConflicts no field is left 'conflict'.
function overallVerdict(verdicts: SyncVerdict): DimensionVerdict {
  const values: DimensionVerdict[] = [
    verdicts.title,
    verdicts.body,
    verdicts.status,
    verdicts.completedAt,
    verdicts.type,
    verdicts.parent,
  ];
  if (values.includes('push')) {
    return 'push';
  }
  if (values.includes('pull')) {
    return 'pull';
  }
  return 'none';
}

// Whether two lane maps agree, so a settled project's bookkeeping is not
// rewritten on every tick.
function sameSections(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every((key) => a[key] === b[key]);
}
