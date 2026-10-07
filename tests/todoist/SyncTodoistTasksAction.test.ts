import { describe, expect, it } from 'vitest';
import { SyncTodoistTasksAction } from '../../src/todoist/SyncTodoistTasksAction.js';
import { ApplyTaskToTodoistAction } from '../../src/todoist/ApplyTaskToTodoistAction.js';
import { SyncGithubTasksAction } from '../../src/github/SyncGithubTasksAction.js';
import { ApplyTaskToGithubAction } from '../../src/github/ApplyTaskToGithubAction.js';
import { ApplyTaskToVaultAction } from '../../src/tasks/ApplyTaskToVaultAction.js';
import { CompleteTaskCascadeAction } from '../../src/tasks/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../src/tasks/CreateTaskNoteAction.js';
import { VerdictResolver } from '../../src/shared/VerdictResolver.js';
import type { BoardItemData } from '../../src/shared/BoardItemData.js';
import type { ProjectDetailData } from '../../src/shared/ProjectDetailData.js';
import type {
  ApplyTaskToTodoistInput,
  ApplyToDoToTodoistInput,
} from '../../src/todoist/ApplyTaskToTodoistAction.js';
import type { ApplyTodoistCompletionAction } from '../../src/todoist/ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from '../../src/todoist/ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from '../../src/todoist/CaptureTodoistCreationsAction.js';
import type { EnsureTodoistSectionsAction } from '../../src/todoist/EnsureTodoistSectionsAction.js';
import type { PropagateTodoistDeletionsAction } from '../../src/todoist/PropagateTodoistDeletionsAction.js';
import { TaskNoteMapper } from '../../src/vault/TaskNoteMapper.js';
import { ToDoNoteMapper } from '../../src/vault/ToDoNoteMapper.js';
import type { CreateTodoistTaskData } from '../../src/todoist/CreateTodoistTaskData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { ProjectStateData } from '../../src/shared/ProjectStateData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import type { TaskManagerPort } from '../../src/shared/TaskManagerPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import { entityRecord, taskData, todoistTask } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';
import { toDiffViewWithBody } from '../../src/shared/toDiffView.js';

class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Map<string, string>();
  folders = new Map<string, string[]>();

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folders.get(folder) ?? [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return [];
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeProjectManagement implements ProjectManagementPort {
  issues: GithubTaskData[] = [];
  detail: ProjectDetailData = { issues: [], cards: [] };

  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return this.issues;
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchProjectDetail(): Promise<ProjectDetailData> {
    return this.detail;
  }
  async fetchProjectStates(): Promise<Map<string, ProjectStateData>> {
    return new Map();
  }
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchUnpromotedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setTaskState(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setBoardStatus(): Promise<void> {}
  async addBoardItem(): Promise<void> {}
  async addLabel(): Promise<void> {}
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchRepoBoards(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createBoardWithStatusField(): Promise<never> {
    throw new Error('not used in this test');
  }
  async listRepoLabels(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createRepoLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
}

class FakeTaskManager implements TaskManagerPort {
  active: TodoistTaskData[] = [];
  createTaskCalls: CreateTodoistTaskData[] = [];
  updateTaskCalls: Array<{ id: string; content: string; labels: string[] }> =
    [];
  moveTaskCalls: Array<{
    id: string;
    to: { sectionId?: string; parentId?: string | null };
  }> = [];
  deleteTaskCalls: string[] = [];
  completeCalls: Array<{ id: string; completed: boolean }> = [];
  ensureLabelCalls: string[] = [];
  // The mutation order across move/delete, so a test can pin that a slice's
  // children are flattened BEFORE the slice twin is deleted.
  mutations: string[] = [];
  failMove = false;
  // Counters so a test can pin the one-snapshot-per-pass contract.
  activeFetches = 0;
  completedFetches = 0;
  failCompleted = false;
  private nextTaskId = 1;

  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
    this.activeFetches++;
    return this.active;
  }
  async fetchProjects(): Promise<TodoistProjectData[]> {
    return [];
  }
  async fetchProject(): Promise<null> {
    return null;
  }
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectArchived(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchSections(): Promise<TodoistSectionData[]> {
    return [];
  }
  async createSection(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateSection(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    this.completedFetches++;
    if (this.failCompleted) {
      throw new Error('completed-since fetch failed');
    }
    return [];
  }
  async createTask(input: CreateTodoistTaskData): Promise<TodoistTaskData> {
    this.createTaskCalls.push(input);
    const id = `T${this.nextTaskId++}`;
    const task = todoistTask({
      id,
      projectId: input.projectId,
      sectionId: input.sectionId ?? null,
      parentId: input.parentId ?? null,
      content: input.content,
      labels: input.labels ?? [],
    });
    this.active.push(task);
    return task;
  }
  async updateTask(
    id: string,
    input: { content: string; labels: string[] },
  ): Promise<void> {
    this.updateTaskCalls.push({ id, ...input });
  }
  async moveTask(
    id: string,
    to: { sectionId?: string; parentId?: string | null },
  ): Promise<void> {
    this.moveTaskCalls.push({ id, to });
    this.mutations.push(`move:${id}`);
    if (this.failMove) {
      throw new Error('move failed');
    }
    const task = this.active.find((candidate) => candidate.id === id);
    if (task) {
      if (to.sectionId !== undefined) {
        task.sectionId = to.sectionId;
      }
      if (to.parentId !== undefined) {
        task.parentId = to.parentId;
      }
    }
  }
  async setTaskCompleted(id: string, completed: boolean): Promise<void> {
    this.completeCalls.push({ id, completed });
  }
  async deleteTask(id: string): Promise<void> {
    this.deleteTaskCalls.push(id);
    this.mutations.push(`delete:${id}`);
    // Model the API's cascade: deleting a parent takes its subtasks with it,
    // so a successful flatten (no child still parented to the twin) is what
    // keeps the children alive.
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const task of this.active) {
        if (
          task.parentId !== null &&
          doomed.has(task.parentId) &&
          !doomed.has(task.id)
        ) {
          doomed.add(task.id);
          grew = true;
        }
      }
    }
    this.active = this.active.filter((task) => !doomed.has(task.id));
  }
  async ensureLabel(name: string): Promise<void> {
    this.ensureLabelCalls.push(name);
  }
}

class FakeWriter {
  taskCalls: ApplyTaskToTodoistInput[] = [];
  todoCalls: ApplyToDoToTodoistInput[] = [];
  taskReturns: string[] = [];
  order: string[] = [];
  private counter = 0;

  async executeTask(input: ApplyTaskToTodoistInput): Promise<string> {
    this.taskCalls.push(input);
    this.order.push(`task:${input.task.title}`);
    const id = `T${++this.counter}`;
    this.taskReturns.push(id);
    return id;
  }
  async executeToDo(input: ApplyToDoToTodoistInput): Promise<string> {
    this.todoCalls.push(input);
    this.order.push(`todo:${input.todo.title}`);
    return `T${++this.counter}`;
  }
}

function recorder(events: string[], name: string) {
  return {
    execute: async () => {
      events.push(name);
    },
  };
}

const projectName = 'Acme Widgets';
const projectId = 'P1';
const syncedAt = '2026-09-18T12:00:00Z';
const taskUrl = 'https://github.com/acme/widgets/issues/42';
const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

const identity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R',
  projectNodeId: 'PVT',
  statusFieldId: 'F',
  statusOptions: [
    { id: 'O1', name: 'Unshaped' },
    { id: 'O2', name: 'Building' },
    { id: 'O3', name: 'Shipped' },
  ],
};

const sections = { Unshaped: 'S1', Building: 'S2', Shipped: 'S3' };

function issue(overrides: Partial<GithubTaskData> = {}): GithubTaskData {
  return {
    url: taskUrl,
    nodeId: 'I',
    title: 'Fix the bug',
    body: '',
    state: 'open',
    createdAt: '2026-09-18T09:00:00Z',
    lastEditedAt: '2026-09-18T11:00:00Z',
    updatedAt: '2026-09-18T11:00:00Z',
    labels: ['type: task'],
    parentUrl: null,
    ...overrides,
  };
}

function taskNote(statusName: string, body = '', todoistId?: string): string {
  const content = TaskNoteMapper.map(
    { type: 'task', title: 'fix the bug', body, createdAt: null },
    { projectName, syncedAt, statusName },
  ).content;
  return todoistId === undefined
    ? content
    : content.replace('---\n', `---\ntodoist: ${todoistId}\n`);
}

// A task note of any type, optionally nested under a parent note stem through
// the affiliation (the parent relation the placement walk follows).
function typedTaskNote(
  type: string,
  title: string,
  statusName: string,
  parentLink: string | null,
): string {
  return TaskNoteMapper.map(
    { type, title, body: '', createdAt: null },
    { projectName, syncedAt, statusName, parentLink },
  ).content;
}

function seedTask(
  syncState: FakeSyncState,
  url: string,
  notePath: string,
  id: string,
): void {
  syncState.seed(entityRecord({ id, notePath }), {
    github: { handle: url },
  });
}

function buildAction(
  vault: FakeVault,
  syncState: FakeSyncState,
  projectManagement: FakeProjectManagement,
  taskManager: FakeTaskManager,
  writer: ApplyTaskToTodoistAction,
): { action: SyncTodoistTasksAction; events: string[] } {
  const events: string[] = [];
  const action = new SyncTodoistTasksAction(
    taskManager,
    projectManagement,
    vault,
    syncState,
    {
      execute: async () => sections,
    } as unknown as EnsureTodoistSectionsAction,
    writer,
    recorder(events, 'applyRemoteChanges') as unknown as ApplyTodoistRemoteChangesAction,
    recorder(events, 'captureCreations') as unknown as CaptureTodoistCreationsAction,
    recorder(events, 'applyCompletion') as unknown as ApplyTodoistCompletionAction,
    recorder(events, 'propagateDeletions') as unknown as PropagateTodoistDeletionsAction,
    'Shipped',
  );
  return { action, events };
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  syncState.identities.set(projectName, identity);
  const projectManagement = new FakeProjectManagement();
  const taskManager = new FakeTaskManager();
  const writer = new FakeWriter();
  const { action, events } = buildAction(
    vault,
    syncState,
    projectManagement,
    taskManager,
    writer as unknown as ApplyTaskToTodoistAction,
  );
  return { action, events, vault, syncState, projectManagement, taskManager, writer };
}

// A composed harness: the REAL writer over the fakes, so the settle property is
// observable end to end.
function composedHarness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  syncState.identities.set(projectName, identity);
  const projectManagement = new FakeProjectManagement();
  const taskManager = new FakeTaskManager();
  const writer = new ApplyTaskToTodoistAction(taskManager, syncState);
  const { action, events } = buildAction(
    vault,
    syncState,
    projectManagement,
    taskManager,
    writer,
  );
  return { action, events, vault, syncState, projectManagement, taskManager, writer };
}

const input = { projectName, projectId, syncedAt };

describe('SYNC-2 — a remote change flows in and fans out', () => {
  it('absorbs remote changes and captures before projecting, deletions last', async () => {
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    seedTask(h.syncState, taskUrl, taskPath, 'uuid-42');

    await h.action.execute(input);

    expect(h.events).toEqual([
      'applyRemoteChanges',
      'captureCreations',
      'applyCompletion',
      'propagateDeletions',
    ]);
    expect(h.writer.taskCalls).toHaveLength(1);
    expect(h.writer.taskCalls[0]!.task.title).toBe('Fix the bug');
    expect(h.writer.taskCalls[0]!.task.status).toBe('Building');
    expect(h.writer.taskCalls[0]!.sectionId).toBe('S2');
    expect(h.writer.taskCalls[0]!.record?.id).toBe('uuid-42');
  });

  it('resolves a tracked task by its registry handle, not a note anchor', async () => {
    const h = harness();
    const registryPath = 'Projecten/Acme Widgets/taken/7-fix-the-bug.md';
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(registryPath, taskNote('Building'));
    seedTask(h.syncState, taskUrl, registryPath, 'uuid-42');

    await h.action.execute(input);

    expect(h.writer.taskCalls[0]!.notePath).toBe(registryPath);
  });

  it('skips the writer when the remote twin moved (per-field pull)', async () => {
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    h.syncState.seed(entityRecord({ id: 'uuid-42', notePath: taskPath }), {
      github: { handle: taskUrl },
      todoist: {
        handle: 'T9',
        // base lane Building; the twin sits in Unshaped
        base: toDiffViewWithBody(
          taskData({
            id: 'uuid-42',
            notePath: taskPath,
            title: 'Fix the bug',
            status: 'Building',
          }),
        ),
      },
    });
    h.taskManager.active = [
      todoistTask({ id: 'T9', content: 'Fix the bug', sectionId: 'S1' }),
    ];

    await h.action.execute(input);

    expect(h.writer.taskCalls).toEqual([]);
  });

  it('diffs per field: a remote title change is a pull even with the updatedAt hint', async () => {
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    h.syncState.seed(entityRecord({ id: 'uuid-42', notePath: taskPath }), {
      github: { handle: taskUrl },
      todoist: {
        handle: 'T9',
        base: toDiffViewWithBody(
          taskData({
            id: 'uuid-42',
            notePath: taskPath,
            title: 'Fix the bug',
            status: 'Building',
          }),
        ),
      },
    });
    h.taskManager.active = [
      todoistTask({
        id: 'T9',
        content: 'Fix the widget',
        sectionId: 'S2',
        updatedAt: '2026-09-18T11:30:00Z',
      }),
    ];

    await h.action.execute(input);

    expect(h.writer.taskCalls).toEqual([]);
  });

  it('pulls a status conflict when the twin update postdates the vault mtime', async () => {
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Unshaped'));
    h.syncState.seed(entityRecord({ id: 'uuid-42', notePath: taskPath }), {
      github: { handle: taskUrl },
      todoist: {
        handle: 'T9',
        base: toDiffViewWithBody(
          taskData({
            id: 'uuid-42',
            notePath: taskPath,
            title: 'Fix the bug',
            status: 'Shipped',
          }),
        ),
      },
    });
    h.vault.modifiedTimes.set(taskPath, '2026-09-19T00:00:00Z');
    h.taskManager.active = [
      todoistTask({
        id: 'T9',
        content: 'Fix the bug',
        sectionId: 'S2',
        updatedAt: '2026-09-20T00:00:00Z',
      }),
    ];

    await h.action.execute(input);

    expect(h.writer.taskCalls).toEqual([]);
  });

  it('pushes the vault lane when the twin update predates the vault mtime', async () => {
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Unshaped'));
    h.syncState.seed(entityRecord({ id: 'uuid-42', notePath: taskPath }), {
      github: { handle: taskUrl },
      todoist: {
        handle: 'T9',
        base: toDiffViewWithBody(
          taskData({
            id: 'uuid-42',
            notePath: taskPath,
            title: 'Fix the bug',
            status: 'Shipped',
          }),
        ),
      },
    });
    h.vault.modifiedTimes.set(taskPath, '2026-09-19T00:00:00Z');
    h.taskManager.active = [
      todoistTask({
        id: 'T9',
        content: 'Fix the bug',
        sectionId: 'S2',
        updatedAt: '2026-09-18T00:00:00Z',
      }),
    ];

    await h.action.execute(input);

    expect(h.writer.taskCalls).toHaveLength(1);
    expect(h.writer.taskCalls[0]!.sectionId).toBe('S1');
  });

  it('records the lane map when the sections moved', async () => {
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    seedTask(h.syncState, taskUrl, taskPath, 'uuid-42');

    await h.action.execute(input);

    expect(h.syncState.todoistProjects.get(projectName)).toEqual({
      sections,
      lastCompletedPoll: input.syncedAt,
    });
  });

  it('gives a slice no Todoist twin and places its child top-level', async () => {
    const h = harness();
    const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
    const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
    const sliceUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    h.projectManagement.issues = [
      issue({ url: sliceUrl, title: 'The slice', labels: ['type: slice'] }),
      issue({ url: childUrl, title: 'The child' }),
    ];
    h.vault.notes.set(
      slicePath,
      typedTaskNote('slice', 'the slice', 'Building', null),
    );
    h.vault.notes.set(
      childPath,
      typedTaskNote('task', 'the child', 'Building', '40-the-slice'),
    );
    seedTask(h.syncState, sliceUrl, slicePath, 'uuid-slice');
    seedTask(h.syncState, childUrl, childPath, 'uuid-child');

    await h.action.execute(input);

    expect(h.writer.order).toEqual(['task:The child']);
    expect(h.writer.taskCalls[0]!.parentId).toBeNull();
    expect(h.writer.taskCalls[0]!.sectionId).toBe('S2');
  });

  it('nests a deep chain from the first materialized ancestor', async () => {
    const h = harness();
    const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
    const taskPath = 'Projecten/Acme Widgets/taken/41-the-task.md';
    const subPath = 'Projecten/Acme Widgets/taken/42-the-sub.md';
    const subSubPath = 'Projecten/Acme Widgets/taken/43-the-sub-sub.md';
    const sliceUrl = 'https://github.com/acme/widgets/issues/40';
    const taskUrl = 'https://github.com/acme/widgets/issues/41';
    const subUrl = 'https://github.com/acme/widgets/issues/42';
    const subSubUrl = 'https://github.com/acme/widgets/issues/43';
    h.projectManagement.issues = [
      issue({ url: sliceUrl, title: 'The slice', labels: ['type: slice'] }),
      issue({ url: taskUrl, title: 'The task' }),
      issue({ url: subUrl, title: 'The sub' }),
      issue({ url: subSubUrl, title: 'The sub-sub' }),
    ];
    h.vault.notes.set(
      slicePath,
      typedTaskNote('slice', 'the slice', 'Building', null),
    );
    h.vault.notes.set(
      taskPath,
      typedTaskNote('task', 'the task', 'Building', '40-the-slice'),
    );
    h.vault.notes.set(
      subPath,
      typedTaskNote('task', 'the sub', 'Building', '41-the-task'),
    );
    h.vault.notes.set(
      subSubPath,
      typedTaskNote('task', 'the sub-sub', 'Building', '42-the-sub'),
    );
    seedTask(h.syncState, sliceUrl, slicePath, 'uuid-slice');
    seedTask(h.syncState, taskUrl, taskPath, 'uuid-task');
    seedTask(h.syncState, subUrl, subPath, 'uuid-sub');
    seedTask(h.syncState, subSubUrl, subSubPath, 'uuid-sub-sub');

    await h.action.execute(input);

    expect(h.writer.order).toEqual([
      'task:The task',
      'task:The sub',
      'task:The sub-sub',
    ]);
    expect(h.writer.taskCalls[0]!.parentId).toBeNull();
    expect(h.writer.taskCalls[1]!.parentId).toBe(h.writer.taskReturns[0]);
    expect(h.writer.taskCalls[2]!.parentId).toBe(h.writer.taskReturns[1]);
  });

  it('retires an existing slice twin, flattening its children before the delete', async () => {
    const h = harness();
    const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
    const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
    const sliceUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    h.projectManagement.issues = [
      issue({ url: sliceUrl, title: 'The slice', labels: ['type: slice'] }),
      issue({ url: childUrl, title: 'The child' }),
    ];
    h.vault.notes.set(
      slicePath,
      typedTaskNote('slice', 'the slice', 'Building', null),
    );
    h.vault.notes.set(
      childPath,
      typedTaskNote('task', 'the child', 'Building', '40-the-slice'),
    );
    h.syncState.seed(entityRecord({ id: 'uuid-slice', notePath: slicePath }), {
      github: { handle: sliceUrl },
      todoist: { handle: 'T-slice' },
    });
    h.syncState.seed(entityRecord({ id: 'uuid-child', notePath: childPath }), {
      github: { handle: childUrl },
      todoist: { handle: 'T-child' },
    });
    h.taskManager.active = [
      todoistTask({ id: 'T-slice', content: 'The slice', sectionId: 'S2', labels: ['slice'] }),
      todoistTask({ id: 'T-child', content: 'The child', parentId: 'T-slice', labels: ['task'] }),
    ];

    await h.action.execute(input);

    expect(h.taskManager.mutations).toEqual(['move:T-child', 'delete:T-slice']);
    expect(h.taskManager.active.map((task) => task.id)).toEqual(['T-child']);
    expect(h.taskManager.active[0]!.parentId).toBeNull();
    expect(await h.syncState.findMirrorItem('todoist', 'T-slice')).toBeNull();
    expect(h.writer.order).toEqual(['task:The child']);
    expect(h.writer.taskCalls[0]!.parentId).toBeNull();
  });

  it('blocks the slice delete when a flatten move fails', async () => {
    const h = harness();
    const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
    const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
    const sliceUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    h.projectManagement.issues = [
      issue({ url: sliceUrl, title: 'The slice', labels: ['type: slice'] }),
      issue({ url: childUrl, title: 'The child' }),
    ];
    h.vault.notes.set(
      slicePath,
      typedTaskNote('slice', 'the slice', 'Building', null),
    );
    h.vault.notes.set(
      childPath,
      typedTaskNote('task', 'the child', 'Building', '40-the-slice'),
    );
    h.syncState.seed(entityRecord({ id: 'uuid-slice', notePath: slicePath }), {
      github: { handle: sliceUrl },
      todoist: { handle: 'T-slice' },
    });
    h.syncState.seed(entityRecord({ id: 'uuid-child', notePath: childPath }), {
      github: { handle: childUrl },
      todoist: { handle: 'T-child' },
    });
    h.taskManager.active = [
      todoistTask({ id: 'T-slice', content: 'The slice', sectionId: 'S2', labels: ['slice'] }),
      todoistTask({ id: 'T-child', content: 'The child', parentId: 'T-slice', labels: ['task'] }),
    ];
    h.taskManager.failMove = true;

    await h.action.execute(input);

    expect(h.taskManager.deleteTaskCalls).toEqual([]);
    expect(h.taskManager.mutations).toEqual(['move:T-child']);
    expect(await h.syncState.findMirrorItem('todoist', 'T-slice')).not.toBeNull();
  });

  it('settles after retiring a slice twin: a second pass writes nothing', async () => {
    const h = composedHarness();
    const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
    const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
    const sliceUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    h.projectManagement.issues = [
      issue({ url: sliceUrl, title: 'The slice', labels: ['type: slice'] }),
      issue({ url: childUrl, title: 'The child' }),
    ];
    h.vault.notes.set(
      slicePath,
      typedTaskNote('slice', 'the slice', 'Building', null),
    );
    h.vault.notes.set(
      childPath,
      typedTaskNote('task', 'the child', 'Building', '40-the-slice'),
    );
    const sliceBase = toDiffViewWithBody(
      taskData({
        id: 'uuid-slice',
        notePath: slicePath,
        title: 'The slice',
        status: 'Building',
        type: 'slice',
      }),
    );
    const childBase = toDiffViewWithBody(
      taskData({
        id: 'uuid-child',
        notePath: childPath,
        title: 'The child',
        status: 'Building',
        type: 'task',
        parent: 'uuid-slice',
      }),
    );
    h.syncState.seed(entityRecord({ id: 'uuid-slice', notePath: slicePath }), {
      github: { handle: sliceUrl, base: sliceBase },
      todoist: { handle: 'T-slice', base: sliceBase },
    });
    h.syncState.seed(entityRecord({ id: 'uuid-child', notePath: childPath }), {
      github: { handle: childUrl, base: childBase },
      todoist: { handle: 'T-child', base: childBase },
    });
    h.taskManager.active = [
      todoistTask({ id: 'T-slice', content: 'The slice', sectionId: 'S2', labels: ['slice'] }),
      todoistTask({ id: 'T-child', content: 'The child', parentId: 'T-slice', labels: ['task'] }),
    ];

    await h.action.execute(input);
    expect(await h.syncState.findMirrorItem('todoist', 'T-slice')).toBeNull();
    expect(h.taskManager.active.map((task) => task.id)).toEqual(['T-child']);

    h.taskManager.createTaskCalls = [];
    h.taskManager.updateTaskCalls = [];
    h.taskManager.moveTaskCalls = [];
    h.taskManager.deleteTaskCalls = [];
    h.taskManager.completeCalls = [];
    h.taskManager.mutations = [];
    await h.action.execute(input);

    expect(h.taskManager.createTaskCalls).toEqual([]);
    expect(h.taskManager.updateTaskCalls).toEqual([]);
    expect(h.taskManager.moveTaskCalls).toEqual([]);
    expect(h.taskManager.deleteTaskCalls).toEqual([]);
    expect(h.taskManager.completeCalls).toEqual([]);
    expect(h.taskManager.active.map((task) => task.content)).not.toContain(
      'The slice',
    );
  });

  it("places a slice's to-do top-level in the slice's lane", async () => {
    const h = harness();
    const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
    const sliceUrl = 'https://github.com/acme/widgets/issues/40';
    const todoPath = 'Projecten/Acme Widgets/todos/step-one.md';
    h.projectManagement.issues = [
      issue({ url: sliceUrl, title: 'The slice', labels: ['type: slice'] }),
    ];
    h.vault.notes.set(
      slicePath,
      TaskNoteMapper.map(
        {
          type: 'slice',
          title: 'the slice',
          body: `- [ ] [[${todoPath}|Step one]]`,
          createdAt: null,
        },
        { projectName, syncedAt, statusName: 'Building' },
      ).content,
    );
    h.vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(
        { title: 'Step one', projectName, taskLink: '40-the-slice' },
        { syncedAt, statusName: 'open' },
      ).content,
    );
    seedTask(h.syncState, sliceUrl, slicePath, 'uuid-slice');
    h.vault.folders.set('Projecten/Acme Widgets/taken', [slicePath]);

    await h.action.execute(input);

    expect(h.writer.todoCalls).toHaveLength(1);
    expect(h.writer.todoCalls[0]!.parentId).toBeNull();
    expect(h.writer.todoCalls[0]!.sectionId).toBe('S2');
  });

  it('nests a sub-issue under a non-slice parent task twin', async () => {
    const h = harness();
    const parentPath = 'Projecten/Acme Widgets/taken/40-the-parent.md';
    const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
    const parentUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    h.projectManagement.issues = [
      issue({ url: parentUrl, title: 'The parent' }),
      issue({ url: childUrl, title: 'The child' }),
    ];
    h.vault.notes.set(
      parentPath,
      TaskNoteMapper.map(
        { type: 'task', title: 'the parent', body: '', createdAt: null },
        { projectName, syncedAt, statusName: 'Building' },
      ).content,
    );
    h.vault.notes.set(
      childPath,
      TaskNoteMapper.map(
        { type: 'task', title: 'the child', body: '', createdAt: null },
        { projectName, syncedAt, statusName: 'Building' },
      ).content.replace(
        'affiliation: ["[[_Acme Widgets]]"]',
        'affiliation: ["[[_Acme Widgets]]", "[[40-the-parent]]"]',
      ),
    );
    seedTask(h.syncState, parentUrl, parentPath, 'uuid-parent');
    seedTask(h.syncState, childUrl, childPath, 'uuid-child');

    await h.action.execute(input);

    expect(h.writer.order).toEqual(['task:The parent', 'task:The child']);
    expect(h.writer.taskCalls[0]!.parentId).toBeNull();
    expect(h.writer.taskCalls[1]!.parentId).toBe(h.writer.taskReturns[0]);
  });

  it('converges an already-adopted sub-issue onto its parent twin in two passes', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    const taskManager = new FakeTaskManager();
    const todoistWriter = new ApplyTaskToTodoistAction(
      taskManager,
      syncState,
    );

    const parentUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    const parentPath = 'Projecten/Acme Widgets/taken/the-parent.md';
    const childPath = 'Projecten/Acme Widgets/taken/the-child.md';
    vault.notes.set(
      parentPath,
      TaskNoteMapper.map(
        { type: 'task', title: 'the parent', body: '', createdAt: null },
        { projectName, syncedAt, statusName: 'Building' },
      ).content,
    );
    vault.notes.set(
      childPath,
      TaskNoteMapper.map(
        { type: 'task', title: 'the child', body: '', createdAt: null },
        { projectName, syncedAt, statusName: 'Building' },
      ).content,
    );

    const parentBase = toDiffViewWithBody(
      taskData({
        id: 'uuid-parent',
        notePath: parentPath,
        title: 'The parent',
        status: 'Building',
        type: 'task',
      }),
    );
    const childBase = toDiffViewWithBody(
      taskData({
        id: 'uuid-child',
        notePath: childPath,
        title: 'The child',
        status: 'Building',
        type: 'task',
      }),
    );
    syncState.seed(entityRecord({ id: 'uuid-parent', notePath: parentPath }), {
      github: { handle: parentUrl, base: parentBase },
      todoist: { handle: 'T-parent', base: parentBase },
    });
    syncState.seed(entityRecord({ id: 'uuid-child', notePath: childPath }), {
      github: { handle: childUrl, base: childBase },
      todoist: { handle: 'T-child', base: childBase },
    });
    taskManager.active = [
      todoistTask({
        id: 'T-parent',
        content: 'The parent',
        sectionId: 'S2',
        labels: ['task'],
      }),
      todoistTask({
        id: 'T-child',
        content: 'The child',
        sectionId: 'S2',
        labels: ['task'],
      }),
    ];

    const parentIssue = issue({
      url: parentUrl,
      title: 'The parent',
    });
    const childIssue = issue({
      url: childUrl,
      title: 'The child',
      parentUrl,
    });
    projectManagement.issues = [parentIssue, childIssue];
    const cards: BoardItemData[] = [
      {
        itemId: 'C1',
        type: 'ISSUE',
        issueUrl: parentUrl,
        statusOptionName: 'Building',
        updatedAt: null,
      },
      {
        itemId: 'C2',
        type: 'ISSUE',
        issueUrl: childUrl,
        statusOptionName: 'Building',
        updatedAt: null,
      },
    ];
    projectManagement.detail = { issues: [parentIssue, childIssue], cards };

    // Pass 1 — the GitHub half sees the parent relation and pulls it into the
    // child's affiliation
    const githubAction = new SyncGithubTasksAction(
      projectManagement,
      syncState,
      vault,
      new ApplyTaskToGithubAction(projectManagement, syncState),
      new ApplyTaskToVaultAction(
        vault,
        syncState,
        new CreateTaskNoteAction(vault, syncState, ''),
        '',
        new CompleteTaskCascadeAction(vault, 'Shipped'),
      ),
      new VerdictResolver('Shipped'),
      'Shipped',
    );
    await githubAction.execute({ projectName, syncedAt, includeBoard: true });

    expect(vault.notes.get(childPath)).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[the-parent]]"]',
    );

    // Pass 2 — the Todoist projection moves the existing top-level twin under
    // the parent's twin
    const { action: todoistAction } = buildAction(
      vault,
      syncState,
      projectManagement,
      taskManager,
      todoistWriter,
    );
    await todoistAction.execute(input);

    expect(taskManager.moveTaskCalls).toContainEqual({
      id: 'T-child',
      to: { parentId: 'T-parent' },
    });
  });

  it('projects a to-do linked from a task checklist', async () => {
    const h = harness();
    const todoPath = 'Projecten/Acme Widgets/todos/step-one.md';
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(
      taskPath,
      taskNote('Building', `- [ ] [[${todoPath}|Step one]]`, 'T-task'),
    );
    h.vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(
        { title: 'Step one', projectName, taskLink: '42-fix-the-bug' },
        { syncedAt, statusName: 'open' },
      ).content,
    );
    seedTask(h.syncState, taskUrl, taskPath, 'uuid-42');
    h.vault.folders.set('Projecten/Acme Widgets/taken', [taskPath]);

    await h.action.execute(input);

    expect(h.writer.todoCalls).toHaveLength(1);
    expect(h.writer.todoCalls[0]!.todo.title).toBe('Step one');
    expect(h.writer.todoCalls[0]!.todo.task).toBe('uuid-42');
    expect(h.writer.todoCalls[0]!.parentId).toBe(h.writer.taskReturns[0]);
  });

  it('settles: a second pass over the composed writer writes nothing', async () => {
    const h = composedHarness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    seedTask(h.syncState, taskUrl, taskPath, 'uuid-42');

    await h.action.execute(input);
    const created = h.taskManager.createTaskCalls.length;
    expect(created).toBe(1);

    await h.action.execute(input);

    expect(h.taskManager.createTaskCalls).toHaveLength(created);
    expect(h.taskManager.updateTaskCalls).toEqual([]);
    expect(h.taskManager.moveTaskCalls).toEqual([]);
    expect(h.taskManager.completeCalls).toEqual([]);
  });

  it('fetches the pass snapshot once and hands it to every consumer', async () => {
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    seedTask(h.syncState, taskUrl, taskPath, 'uuid-42');

    await h.action.execute(input);

    expect(h.taskManager.completedFetches).toBe(1);
    expect(h.taskManager.activeFetches).toBe(1);
  });

  it('aborts the half before any absorber when the snapshot fetch fails', async () => {
    const h = harness();
    h.taskManager.failCompleted = true;

    await h.action.execute(input);

    expect(h.events).toEqual([]);
    expect(h.writer.taskCalls).toEqual([]);
    expect(h.syncState.portStateSets).toEqual([]);
  });

  it('swallows a step failure so the GitHub half is never affected', async () => {
    const events: string[] = [];
    const action = new SyncTodoistTasksAction(
      new FakeTaskManager(),
      new FakeProjectManagement(),
      new FakeVault(),
      new FakeSyncState(),
      { execute: async () => sections } as unknown as EnsureTodoistSectionsAction,
      new FakeWriter() as unknown as ApplyTaskToTodoistAction,
      {
        execute: async () => {
          throw new Error('todoist failed');
        },
      } as unknown as ApplyTodoistRemoteChangesAction,
      recorder(events, 'captureCreations') as unknown as CaptureTodoistCreationsAction,
      recorder(events, 'applyCompletion') as unknown as ApplyTodoistCompletionAction,
      recorder(events, 'propagateDeletions') as unknown as PropagateTodoistDeletionsAction,
      'Shipped',
    );

    await expect(action.execute(input)).resolves.toBeUndefined();

    expect(events).toEqual([]);
  });
});
