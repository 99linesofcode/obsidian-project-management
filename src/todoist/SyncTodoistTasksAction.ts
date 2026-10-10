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
import { connectionSlugForTool } from '../shared/connectionSlugForTool.js';

interface ProjectionItem {
  issue: { url: string; title: string; labels: string[] };
  record: EntityRecord;
  notePath: string;
  noteContent: string;
  type: string;
  lane: string;
  parentLink: string | null;
  handle: string | null;
  base: TaskData | null;
}

export class SyncTodoistTasksAction implements ConnectionSyncHalf {
  readonly requiresBoard = false;
  private readonly verdictResolver: VerdictResolver;
  private readonly retireSliceTwins: RetireSliceTwinsAction;
  private readonly collectProjectToDos: CollectProjectToDosAction;

  constructor(
    readonly connectionSlug: string,
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
    const githubConnectionSlug = connectionSlugForTool(
      input.connections,
      'github',
    );
    try {
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

      const active = snapshot.active;
      const { twinIdByNotePath, sections } = await this.projectTasks(
        input,
        active,
        githubConnectionSlug,
      );
      await this.projectToDos(input, active, twinIdByNotePath, sections);

      await this.propagateTodoistDeletions.execute({
        projectName: input.projectName,
        connectionSlug: this.connectionSlug,
        githubConnectionSlug,
      });
    } catch (error) {
      console.error('SyncTodoistTasksAction: Todoist half failed', error);
    }
  }

  private async projectTasks(
    input: ConnectionSyncInput,
    active: TodoistTaskData[],
    githubConnectionSlug: string | null,
  ): Promise<{
    twinIdByNotePath: Map<string, string>;
    sections: Record<string, string>;
  }> {
    const taskTwinIdByNotePath = new Map<string, string>();
    const identity =
      githubConnectionSlug === null
        ? null
        : await this.syncState.getIdentity(
            input.projectName,
            githubConnectionSlug,
          );
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

    await this.retireSliceTwins.execute({
      projectName: input.projectName,
      connectionSlug: this.connectionSlug,
      sliceHandles: items
        .filter((item) => item.type === 'slice')
        .map((item) => item.handle)
        .filter((handle): handle is string => handle !== null),
      active,
    });

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
    const nested = placements
      .filter((entry) => entry.ancestor !== null)
      .sort((a, b) => a.depth - b.depth);

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
        break;
      }
      if (parent.type !== 'slice') {
        return { ancestor: parent, depth };
      }
      link = parent.parentLink;
    }
    return { ancestor: null, depth };
  }

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

    if (current !== null && handle !== null && base !== null) {
      const remote = this.remoteView(
        current,
        item.record,
        sections,
        parentUuid,
      );
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

  private async rootToDoPlacement(
    item: ToDoItem,
    taskTwinIdByNotePath: Map<string, string>,
    todoistByEntity: Map<string, { handle: string; base: TaskData | null }>,
    sections: Record<string, string>,
  ): Promise<{ parentId: string | null; sectionId: string | null } | null> {
    if (item.taskType === 'slice') {
      return { parentId: null, sectionId: sections[item.taskLane] ?? null };
    }
    const parentId = await this.parentTaskTwinId(
      item.taskNotePath,
      taskTwinIdByNotePath,
      todoistByEntity,
    );
    return parentId === null ? null : { parentId, sectionId: null };
  }

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

  private vaultView(
    item: ProjectionItem,
    placement: { sectionId: string | null; parentId: string | null },
    parentUuid: string | null,
  ): TaskData {
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

  private async todoistHandleForPath(
    notePath: string,
    todoistByEntity: Map<string, { handle: string; base: TaskData | null }>,
  ): Promise<string | null> {
    const record = await this.syncState.findByNotePath(notePath);
    return record === null
      ? null
      : (todoistByEntity.get(record.id)?.handle ?? null);
  }

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
