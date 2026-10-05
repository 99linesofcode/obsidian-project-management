import { describe, expect, it } from 'vitest';
import { SyncTodoistTasksAction } from '../../../src/Domain/Actions/SyncTodoistTasksAction.js';
import { ApplyTaskToTodoistAction } from '../../../src/Domain/Actions/ApplyTaskToTodoistAction.js';
import { SyncGithubTasksAction } from '../../../src/Domain/Actions/SyncGithubTasksAction.js';
import { ApplyTaskToGithubAction } from '../../../src/Domain/Actions/ApplyTaskToGithubAction.js';
import { ApplyTaskToVaultAction } from '../../../src/Domain/Actions/ApplyTaskToVaultAction.js';
import { CompleteTaskCascadeAction } from '../../../src/Domain/Actions/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { VerdictResolver } from '../../../src/Domain/Reconciliation/VerdictResolver.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { ProjectDetailData } from '../../../src/Domain/DataTransferObjects/ProjectDetailData.js';
import type {
  ApplyTaskToTodoistInput,
  ApplyToDoToTodoistInput,
} from '../../../src/Domain/Actions/ApplyTaskToTodoistAction.js';
import type { ApplyTodoistCompletionAction } from '../../../src/Domain/Actions/ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from '../../../src/Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from '../../../src/Domain/Actions/CaptureTodoistCreationsAction.js';
import type { EnsureTodoistSectionsAction } from '../../../src/Domain/Actions/EnsureTodoistSectionsAction.js';
import type { PropagateTodoistDeletionsAction } from '../../../src/Domain/Actions/PropagateTodoistDeletionsAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import { entityRecord, taskData, todoistTask } from '../../helpers/records.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';
import { toDiffViewWithBody } from '../../../src/Domain/Reconciliation/toDiffView.js';

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
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteCard(): Promise<never> {
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
    to: { sectionId?: string; parentId?: string };
  }> = [];
  completeCalls: Array<{ id: string; completed: boolean }> = [];
  ensureLabelCalls: string[] = [];
  private nextTaskId = 1;

  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
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
    to: { sectionId?: string; parentId?: string },
  ): Promise<void> {
    this.moveTaskCalls.push({ id, to });
    const task = this.active.find((candidate) => candidate.id === id);
    if (task) {
      task.sectionId = to.sectionId ?? task.sectionId;
      task.parentId = to.parentId ?? task.parentId;
    }
  }
  async setTaskCompleted(id: string, completed: boolean): Promise<void> {
    this.completeCalls.push({ id, completed });
  }
  async deleteTask(): Promise<never> {
    throw new Error('not used in this test');
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
    remoteId: 42,
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
  const writer = new ApplyTaskToTodoistAction(taskManager, vault, syncState);
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

describe('SyncTodoistTasksAction', () => {
  it('absorbs remote changes and captures before projecting, deletions last', async () => {
    // Given — a tracked issue with a task note
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    seedTask(h.syncState, taskUrl, taskPath, 'uuid-42');

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the retained steps run around the canonical projection
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
    // Given — a tracked issue whose note lives at a non-slug path the registry
    // points at
    const h = harness();
    const registryPath = 'Projecten/Acme Widgets/taken/7-fix-the-bug.md';
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(registryPath, taskNote('Building'));
    seedTask(h.syncState, taskUrl, registryPath, 'uuid-42');

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the projection follows the record's note path
    expect(h.writer.taskCalls[0]!.notePath).toBe(registryPath);
    expect(h.writer.taskCalls[0]!.noteContent).toContain('status: Building');
  });

  it('skips the writer when the remote twin moved (per-field pull)', async () => {
    // Given — a tracked task whose twin sits in another lane than the base
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

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the remote moved, so the writer is not asked to re-push
    expect(h.writer.taskCalls).toEqual([]);
  });

  it('diffs per field: a remote title change is a pull even with the updatedAt hint', async () => {
    // Given — a tracked task whose twin was renamed in Todoist
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

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the title field alone drives the pull, and the writer is skipped
    expect(h.writer.taskCalls).toEqual([]);
  });

  it('pulls a status conflict when the twin update postdates the vault mtime', async () => {
    // Given — both sides changed the lane and the twin's own update is newer
    // than the note's mtime
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

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the remote lane wins on the decisive timestamp, so no push runs
    expect(h.writer.taskCalls).toEqual([]);
  });

  it('pushes the vault lane when the twin update predates the vault mtime', async () => {
    // Given — both sides changed the lane and the twin's update is older
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

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the timestamp is not decisive; origin authority moves the twin to
    // the vault's lane
    expect(h.writer.taskCalls).toHaveLength(1);
    expect(h.writer.taskCalls[0]!.sectionId).toBe('S1');
  });

  it('records the lane map when the sections moved', async () => {
    // Given — a project with no stored lane map
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    seedTask(h.syncState, taskUrl, taskPath, 'uuid-42');

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the lane map is persisted
    expect(h.syncState.todoistProjects.get(projectName)).toEqual({
      sections,
      lastCompletedPoll: input.syncedAt,
    });
  });

  it('nests a child under its slice twin (two phases, parents first)', async () => {
    // Given — a slice and a child affiliated to it
    const h = harness();
    const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
    const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
    const sliceUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    h.projectManagement.issues = [
      issue({ url: sliceUrl, remoteId: 40, title: 'The slice', labels: ['type: slice'] }),
      issue({ url: childUrl, remoteId: 42, title: 'The child' }),
    ];
    h.vault.notes.set(
      slicePath,
      TaskNoteMapper.map(
        { type: 'slice', title: 'the slice', body: '', createdAt: null },
        { projectName, syncedAt, statusName: 'Building' },
      ).content,
    );
    h.vault.notes.set(
      childPath,
      TaskNoteMapper.map(
        { type: 'task', title: 'the child', body: '', createdAt: null },
        { projectName, syncedAt, statusName: 'Building' },
      ).content.replace(
        'affiliation: ["[[Acme Widgets]]"]',
        'affiliation: ["[[Acme Widgets]]", "[[40-the-slice]]"]',
      ),
    );
    seedTask(h.syncState, sliceUrl, slicePath, 'uuid-slice');
    seedTask(h.syncState, childUrl, childPath, 'uuid-child');

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the slice precedes its child and the child hangs off the slice twin
    expect(h.writer.order).toEqual(['task:The slice', 'task:The child']);
    expect(h.writer.taskCalls[0]!.parentId).toBeNull();
    expect(h.writer.taskCalls[1]!.parentId).toBe(h.writer.taskReturns[0]);
  });

  it('nests a sub-issue under a non-slice parent task twin', async () => {
    // Given — a plain parent task and a child affiliated to it (a GitHub
    // sub-issue of a non-slice task)
    const h = harness();
    const parentPath = 'Projecten/Acme Widgets/taken/40-the-parent.md';
    const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
    const parentUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    h.projectManagement.issues = [
      issue({ url: parentUrl, remoteId: 40, title: 'The parent' }),
      issue({ url: childUrl, remoteId: 42, title: 'The child' }),
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
        'affiliation: ["[[Acme Widgets]]"]',
        'affiliation: ["[[Acme Widgets]]", "[[40-the-parent]]"]',
      ),
    );
    seedTask(h.syncState, parentUrl, parentPath, 'uuid-parent');
    seedTask(h.syncState, childUrl, childPath, 'uuid-child');

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the parent is created top-level and the child hangs under it
    expect(h.writer.order).toEqual(['task:The parent', 'task:The child']);
    expect(h.writer.taskCalls[0]!.parentId).toBeNull();
    expect(h.writer.taskCalls[1]!.parentId).toBe(h.writer.taskReturns[0]);
  });

  it('converges an already-adopted sub-issue onto its parent twin in two passes', async () => {
    // Given — a tracked parent and an already-adopted sub-issue whose note has
    // no affiliation yet and whose twin still sits top-level
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    const taskManager = new FakeTaskManager();
    const todoistWriter = new ApplyTaskToTodoistAction(
      taskManager,
      vault,
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
      remoteId: 40,
      title: 'The parent',
    });
    const childIssue = issue({
      url: childUrl,
      remoteId: 42,
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
      'affiliation: ["[[Acme Widgets]]", "[[the-parent]]"]',
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
    // Given — a tracked task with a linked to-do note
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

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the to-do is projected under the task's twin, with its owning task
    // uuid resolved
    expect(h.writer.todoCalls).toHaveLength(1);
    expect(h.writer.todoCalls[0]!.todo.title).toBe('Step one');
    expect(h.writer.todoCalls[0]!.todo.task).toBe('uuid-42');
    expect(h.writer.todoCalls[0]!.parentId).toBe(h.writer.taskReturns[0]);
  });

  it('settles: a second pass over the composed writer writes nothing', async () => {
    // Given — a clean tree rebuilt in one pass by the real writer
    const h = composedHarness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    seedTask(h.syncState, taskUrl, taskPath, 'uuid-42');

    await h.action.execute(input);
    const created = h.taskManager.createTaskCalls.length;
    expect(created).toBe(1);

    // When — a second pass runs with no external change
    await h.action.execute(input);

    // Then — nothing is created, updated, moved or completed again
    expect(h.taskManager.createTaskCalls).toHaveLength(created);
    expect(h.taskManager.updateTaskCalls).toEqual([]);
    expect(h.taskManager.moveTaskCalls).toEqual([]);
    expect(h.taskManager.completeCalls).toEqual([]);
  });

  it('swallows a step failure so the GitHub half is never affected', async () => {
    // Given — a remote-absorption step that throws
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

    // When — the Todoist half runs
    await expect(action.execute(input)).resolves.toBeUndefined();

    // Then — no later step ran and the failure did not propagate
    expect(events).toEqual([]);
  });
});
