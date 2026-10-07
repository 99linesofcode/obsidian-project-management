import { laneForSection } from '../tasks/laneForSection.js';
import { TaskData } from '../shared/TaskData.js';
import { ToDoData } from '../shared/ToDoData.js';
import { hasTypeLabel } from '../shared/hasTypeLabel.js';
import { typeFromLabels } from '../shared/typeFromLabels.js';
import { TodoistTaskMapper } from './TodoistTaskMapper.js';
import { stemOf } from '../shared/stemOf.js';
import { taskLinkFromAffiliation } from '../shared/taskLinkFromAffiliation.js';
import { TaskNoteParser } from '../vault/TaskNoteParser.js';
import { ToDoNoteParser } from '../vault/ToDoNoteParser.js';
import type { ConflictHints } from '../shared/VerdictResolver.js';
import { VerdictResolver } from '../shared/VerdictResolver.js';
import { overallVerdict, todoistDiffView } from '../shared/Reconciliation.js';
import { sameSections } from './EnsureTodoistSectionsAction.js';
import { takenNotePath } from '../tasks/takenNotePath.js';
import { todoistEntries } from '../registry/todoistEntries.js';
import { RetireSliceTwinsAction } from './RetireSliceTwinsAction.js';
import {
  CollectProjectToDosAction,
  type ToDoItem,
} from '../tasks/CollectProjectToDosAction.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { TaskManagerPort } from '../shared/TaskManagerPort.js';
import type { VaultPort } from '../shared/VaultPort.js';
import type { TodoistSectionData } from './TodoistSectionData.js';
import type { TodoistTaskData } from './TodoistTaskData.js';
import type { ApplyTaskToTodoistAction } from './ApplyTaskToTodoistAction.js';
import type { ApplyTodoistCompletionAction } from './ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from './ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from './CaptureTodoistCreationsAction.js';
import type { EnsureTodoistSectionsAction } from './EnsureTodoistSectionsAction.js';
import type { PropagateTodoistDeletionsAction } from './PropagateTodoistDeletionsAction.js';
import type {
  ConnectionSyncHalf,
  ConnectionSyncInput,
} from '../sync/SyncHalves.js';
import type { ConnectionData } from '../shared/ConnectionData.js';

// One tracked issue resolved to its vault note and registry record: the issue
// carries the type label and the title, the note carries the lane (its status)
// and the parent affiliation.
interface ProjectionItem {
  issue: { url: string; title: string; labels: string[] };
  record: EntityRecord;
  notePath: string;
  noteContent: string;
  type: string;
  lane: string;
  // The immediate parent link named by the affiliation (a slice or a parent
  // task); null for a root. Placement walks this chain (dt-23).
  parentLink: string | null;
  // The todoist mirror handle and base, resolved from the registry's port
  // items because the entity no longer carries them.
  handle: string | null;
  base: TaskData | null;
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
export class SyncTodoistTasksAction implements ConnectionSyncHalf {
  readonly requiresBoard = false;
  private readonly verdictResolver: VerdictResolver;
  private readonly retireSliceTwins: RetireSliceTwinsAction;
  private readonly collectProjectToDos: CollectProjectToDosAction;

  constructor(
    readonly connectionSlug: string,
    // The remote project this connection's adapter is bound to, from the
    // connection's `project` value.
    private readonly projectId: string,
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
    this.retireSliceTwins = new RetireSliceTwinsAction(taskManager, syncState);
    this.collectProjectToDos = new CollectProjectToDosAction(vault);
  }

  async execute(input: ConnectionSyncInput): Promise<void> {
    const githubConnectionSlug = this.githubSlug(input.connections);
    try {
      // The pass's ONE Todoist snapshot: the completed-since window plus the
      // active set, fetched once and shared by every absorber and the
      // projection. The window is bounded by the cursor stored before this
      // pass; only the completion absorber advances it, at the end. A fetch
      // failure aborts the half before any absorber runs, so the cursor and the
      // vault are left untouched and the window retries next tick.
      const portState = await this.syncState.getPortState(
        input.projectName,
        this.connectionSlug,
      );
      const since = portState?.lastPoll || input.syncedAt;
      const snapshot = {
        completed: await this.taskManager.fetchCompletedTasks(
          this.projectId,
          since,
        ),
        active: await this.taskManager.fetchActiveTasks(this.projectId),
      };

      // Remote -> vault first: a remote change is never clobbered by a
      // vault-side push. Both absorbers are retained (see the class comment).
      // Capture runs before the completion pass: it reads the completed-since
      // window from the stored cursor, which ApplyTodoistCompletion advances.
      await this.applyTodoistRemoteChanges.execute({
        projectName: input.projectName,
        connectionSlug: this.connectionSlug,
        githubConnectionSlug,
        syncedAt: input.syncedAt,
        snapshot,
      });
      await this.captureTodoistCreations.execute({
        projectName: input.projectName,
        connectionSlug: this.connectionSlug,
        githubConnectionSlug,
        syncedAt: input.syncedAt,
        snapshot,
      });
      await this.applyTodoistCompletion.execute({
        projectName: input.projectName,
        connectionSlug: this.connectionSlug,
        githubConnectionSlug,
        syncedAt: input.syncedAt,
        snapshot,
      });

      // The projection reads the pass's snapshot; no second fetch.
      const active = snapshot.active;
      // The pass-level twin plan: projectTasks creates every top-level twin
      // first (phase A) and returns note-path -> twin-id for the whole tree, so
      // projectToDos can hang each to-do off a parent that exists in this pass
      // (phase B) instead of a possibly-stale note anchor.
      const { twinIdByNotePath, sections } = await this.projectTasks(
        input,
        active,
        githubConnectionSlug,
      );
      await this.projectToDos(input, active, twinIdByNotePath, sections);

      // Deletions last.
      await this.propagateTodoistDeletions.execute({
        projectName: input.projectName,
        connectionSlug: this.connectionSlug,
        githubConnectionSlug,
      });
    } catch (error) {
      // A Todoist failure must never break the GitHub half.
      console.error('SyncTodoistTasksAction: Todoist half failed', error);
    }
  }

  // The project's code-host connection slug, when it has one. A remote lane
  // drag propagates onto that connection's issue and board card.
  private githubSlug(
    connections: Record<string, ConnectionData>,
  ): string | null {
    for (const [slug, connection] of Object.entries(connections)) {
      if (connection.tool === 'github') {
        return slug;
      }
    }
    return null;
  }

  // The vault's tracked tasks projected onto their twins in TWO PHASES. A
  // slice never materializes (dt-23), so it is skipped and any existing slice
  // twin is retired. Phase A creates every top-level twin first — a standalone
  // task's twin and a slice's top-level child's twin — so phase B can wire a
  // child to the nearest MATERIALIZED ancestor that exists in this very pass.
  // The returned map (note path -> twin id) is the pass's twin plan;
  // projectToDos hangs each to-do off it, and the lane map places a top-level
  // to-do whose parent is a slice.
  private async projectTasks(
    input: ConnectionSyncInput,
    active: TodoistTaskData[],
    githubConnectionSlug: string | null,
  ): Promise<{ twinIdByNotePath: Map<string, string>; sections: Record<string, string> }> {
    const taskTwinIdByNotePath = new Map<string, string>();
    const identity =
      githubConnectionSlug === null
        ? null
        : await this.syncState.getIdentity(
            input.projectName,
            githubConnectionSlug,
          );
    // A project without a GitHub attach has no typed issues to project (dt-03).
    if (!identity?.repoUrl) {
      return { twinIdByNotePath: taskTwinIdByNotePath, sections: {} };
    }

    const portState = await this.syncState.getPortState(
      input.projectName,
      this.connectionSlug,
    );
    const storedSections = portState?.lanes ?? {};
    const sections = await this.ensureSections.execute({
      projectId: this.projectId,
      laneNames: identity.statusOptions.map((option) => option.name),
      stored: storedSections,
    });
    // Only rewrite the bookkeeping when the lane map actually moved, so a
    // settled project performs no write at all.
    if (!portState || !sameSections(sections, storedSections)) {
      await this.syncState.setPortState(
        input.projectName,
        this.connectionSlug,
        {
          provider: 'todoist',
          project: this.projectId,
          lastPoll: portState?.lastPoll ?? input.syncedAt,
          lanes: sections,
        },
      );
    }

    const issues = (
      await this.projectManagement.fetchTrackedIssues(identity.repoUrl)
    ).filter((issue) => hasTypeLabel(issue.labels));
    const activeById = new Map(active.map((task) => [task.id, task] as const));
    const todoistByEntity = await this.todoistItems(input.projectName);

    const items: ProjectionItem[] = [];
    for (const issue of issues) {
      const mirror =
        githubConnectionSlug === null
          ? null
          : await this.syncState.findMirrorItem(
              githubConnectionSlug,
              issue.url,
            );
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
      if (type === '') {
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
        parentLink: taskLinkFromAffiliation(
          parsed.affiliation,
          input.projectName,
        ),
        handle: todoist?.handle ?? null,
        base: todoist?.base ?? null,
      });
    }

    // dt-23: a slice is a project-management artifact — it syncs to the vault
    // and the board but never to Todoist. Retire any twin a previous model
    // created, flattening its children first (the API cascades a parent
    // deletion to subtasks).
    await this.retireSliceTwins.execute({
      projectName: input.projectName,
      connectionSlug: this.connectionSlug,
      sliceHandles: items
        .filter((item) => item.type === 'slice')
        .map((item) => item.handle)
        .filter((handle): handle is string => handle !== null),
      active,
    });

    // Placement resolves the nearest MATERIALIZED ancestor per item: the slice
    // is where materialization stops, so a chain that reaches a slice (or a
    // root) is top-level in its lane's section. Decomposition lives on the
    // board; stage lives in the sections.
    const itemByNotePath = new Map(
      items.map((item) => [item.notePath, item] as const),
    );
    const placements = items
      .filter((item) => item.type !== 'slice')
      .map((item) => ({
        item,
        ...this.placementAncestor(item, itemByNotePath, input.projectName),
      }));
    const topLevel = placements.filter((entry) => entry.ancestor === null);
    // Parents before children: a deeper item resolves the twin its ancestor
    // gained earlier in this same phase.
    const nested = placements
      .filter((entry) => entry.ancestor !== null)
      .sort((a, b) => a.depth - b.depth);

    // Phase A — every top-level twin (a standalone task and a slice's child
    // alike). Creating them before any child lets phase B resolve a real
    // parent id in this pass.
    for (const { item } of topLevel) {
      const taskId = await this.projectItem(
        item,
        { sectionId: sections[item.lane] ?? null, parentId: null },
        activeById,
        sections,
        input,
      );
      taskTwinIdByNotePath.set(item.notePath, taskId);
    }

    // Phase B — nested tasks attach to the nearest materialized ancestor's twin
    // (from this pass's map, else the registry). A sub-issue of a task and a
    // sub-sub-issue of that sub-issue both resolve here; a child whose ancestor
    // twin cannot exist yet waits for the next tick.
    for (const { item, ancestor } of nested) {
      const parentId =
        taskTwinIdByNotePath.get(ancestor!.notePath) ??
        (await this.todoistHandleForPath(ancestor!.notePath, todoistByEntity));
      if (parentId === null) {
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

    return { twinIdByNotePath: taskTwinIdByNotePath, sections };
  }



  // The nearest ancestor that materializes in Todoist, walking the affiliation
  // parent chain. A slice does not materialize, so the walk continues past it;
  // a chain that reaches a slice (or a root, or an untracked ancestor) yields
  // no ancestor — the item sits top-level. depth orders the pass so ancestors
  // gain their twins before descendants.
  private placementAncestor(
    item: ProjectionItem,
    itemByNotePath: Map<string, ProjectionItem>,
    projectName: string,
  ): { ancestor: ProjectionItem | null; depth: number } {
    let link = item.parentLink;
    let depth = 0;
    const seen = new Set<string>();
    while (link !== null) {
      depth++;
      const path = takenNotePath(projectName, link);
      if (seen.has(path)) {
        break;
      }
      seen.add(path);
      const parent = itemByNotePath.get(path);
      if (parent === undefined) {
        // The named ancestor is not a tracked issue, so no twin can exist.
        break;
      }
      if (parent.type !== 'slice') {
        return { ancestor: parent, depth };
      }
      link = parent.parentLink;
    }
    return { ancestor: null, depth };
  }

  // Projects one task through the canonical pipeline and returns its twin id.
  private async projectItem(
    item: ProjectionItem,
    placement: { sectionId: string | null; parentId: string | null },
    activeById: Map<string, TodoistTaskData>,
    sections: Record<string, string>,
    input: ConnectionSyncInput,
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
      const vaultDiff = todoistDiffView(vault);
      const remoteDiff = todoistDiffView(remote);
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
      projectId: this.projectId,
      sectionId: placement.sectionId,
      parentId: placement.parentId,
      labels: [item.type],
      notePath: item.notePath,
      connectionSlug: this.connectionSlug,
      syncedAt: input.syncedAt,
    });
  }

  // The vault's to-dos projected onto their twins. Every task twin that can
  // exist already does (the task phase ran first), so a root to-do hangs off a
  // real task twin — unless its owning task is a slice, which has no twin
  // (dt-23), in which case the to-do sits top-level in the slice's lane. A
  // to-do whose parent twin cannot exist is an orphan owned by the
  // vault-consistency pass: it is skipped, never created top-level.
  private async projectToDos(
    input: ConnectionSyncInput,
    active: TodoistTaskData[],
    taskTwinIdByNotePath: Map<string, string>,
    sections: Record<string, string>,
  ): Promise<void> {
    const items = await this.collectProjectToDos.execute(input.projectName);
    if (items.length === 0) {
      return;
    }
    const activeById = new Map(active.map((task) => [task.id, task] as const));
    const todoistByEntity = await this.todoistItems(input.projectName);

    const roots = items.filter((item) => item.parentStem === null);
    const nested = items.filter((item) => item.parentStem !== null);

    const twinIdByStem = new Map<string, string>();
    for (const item of roots) {
      const placement = await this.rootToDoPlacement(
        item,
        taskTwinIdByNotePath,
        todoistByEntity,
        sections,
      );
      if (placement === null) {
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
        placement,
        activeById,
        todoistByEntity,
        input,
      );
      twinIdByStem.set(stemOf(item.notePath), id);
    }

    for (const item of nested) {
      const parentId =
        twinIdByStem.get(item.parentStem!) ??
        (await this.todoistHandleForPath(
          `Projecten/${input.projectName}/todos/${item.parentStem}.md`,
          todoistByEntity,
        ));
      if (parentId === null) {
        // The parent to-do has no twin yet; the child waits for the next tick.
        continue;
      }
      await this.projectToDoItem(
        item,
        { parentId, sectionId: null },
        activeById,
        todoistByEntity,
        input,
      );
    }
  }

  // A root to-do's placement: under its owning task's twin, or top-level in the
  // owning slice's lane section when the task is a slice (dt-23). Null when the
  // owning task has no twin and none can exist this pass.
  private async rootToDoPlacement(
    item: ToDoItem,
    taskTwinIdByNotePath: Map<string, string>,
    todoistByEntity: Map<string, { handle: string; base: TaskData | null }>,
    sections: Record<string, string>,
  ): Promise<{ parentId: string | null; sectionId: string | null } | null> {
    if (item.taskType === 'slice') {
      // A slice has no twin to nest under; the to-do sits top-level in the
      // slice's lane, where its stage is tracked.
      return { parentId: null, sectionId: sections[item.taskLane] ?? null };
    }
    const parentId = await this.parentTaskTwinId(
      item.taskNotePath,
      taskTwinIdByNotePath,
      todoistByEntity,
    );
    return parentId === null ? null : { parentId, sectionId: null };
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
    return await this.todoistHandleForPath(taskNotePath, todoistByEntity);
  }

  private async projectToDoItem(
    item: ToDoItem,
    placement: { parentId: string | null; sectionId: string | null },
    activeById: Map<string, TodoistTaskData>,
    todoistByEntity: Map<string, { handle: string; base: TaskData | null }>,
    input: ConnectionSyncInput,
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
      projectId: this.projectId,
      parentId: placement.parentId,
      sectionId: placement.sectionId,
      projectName: input.projectName,
      notePath: item.notePath,
      connectionSlug: this.connectionSlug,
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
    return new TaskData({
      id: item.record.id,
      notePath: item.notePath,
      mirrors: {},
      title: item.issue.title,
      body: '',
      status: lane,
      completedAt: done ? '' : null,
      type: item.type,
      parent: parentUuid,
      createdAt: null,
      updatedAt: null,
    });
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
    return new TaskData({
      id: record.id,
      notePath: record.notePath,
      mirrors: { todoist: twin.id },
      title: parsed.title,
      body: '',
      status: lane,
      completedAt: done ? (twin.completedAt ?? '') : null,
      type: parsed.type,
      parent: parentUuid,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    });
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



  // The project's todoist items keyed by hub entity, so a record's handle and
  // base resolve without the entity carrying them.
  private async todoistItems(
    projectName: string,
  ): Promise<Map<string, { handle: string; base: TaskData | null }>> {
    const result = new Map<string, { handle: string; base: TaskData | null }>();
    for (const { handle, record, base } of await todoistEntries(
      this.syncState,
      this.connectionSlug,
      projectName,
    )) {
      result.set(record.id, { handle, base });
    }
    return result;
  }

  // The todoist handle of the record at a note path, or null when the note has
  // no mirror yet. The registry is the anchor now, not the note's frontmatter.
  private async todoistHandleForPath(
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
      (await this.syncState.findMirrorItem(this.connectionSlug, twinId))
        ?.entityId ?? null
    );
  }
}

