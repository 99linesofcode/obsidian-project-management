import { describe, expect, it } from 'vitest';
import { SyncTodoistTasksAction } from '../../../src/Domain/Actions/SyncTodoistTasksAction.js';
import { ApplyTaskToTodoistAction } from '../../../src/Domain/Actions/ApplyTaskToTodoistAction.js';
import type {
  ApplyTaskToTodoistInput,
  ApplyToDoToTodoistInput,
} from '../../../src/Domain/Actions/ApplyTaskToTodoistAction.js';
import type { ApplyTodoistCompletionAction } from '../../../src/Domain/Actions/ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from '../../../src/Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from '../../../src/Domain/Actions/CaptureTodoistCreationsAction.js';
import type { EnsureTodoistSectionsAction } from '../../../src/Domain/Actions/EnsureTodoistSectionsAction.js';
import type { PropagateTodoistDeletionsAction } from '../../../src/Domain/Actions/PropagateTodoistDeletionsAction.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

class FakeVault implements VaultPort {
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

class FakeSyncState implements SyncStatePort {
  identity: ProjectIdentityData | null = {
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
  statuses = new Map<string, TaskData>();
  todoistStates = new Map<string, TaskData>();
  projectState: TodoistProjectStateData | null = null;
  projectStateSets: TodoistProjectStateData[] = [];

  async get(url: string): Promise<TaskData | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<TaskData | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<TaskData[]> {
    return [...this.statuses.values()];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }
  async setLastProjectUpdate(): Promise<void> {}
  async getArchiveBaseline(): Promise<null> {
    return null;
  }
  async setArchiveBaseline(): Promise<void> {}
  async getWatchState(): Promise<{ etag: null; cursor: null }> {
    return { etag: null, cursor: null };
  }
  async setWatchState(): Promise<void> {}
  async getTodoistProjectState(): Promise<TodoistProjectStateData | null> {
    return this.projectState;
  }
  async setTodoistProjectState(
    _projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    this.projectStateSets.push(state);
    this.projectState = state;
  }
  async getTodoistState(notePath: string): Promise<TaskData | null> {
    return this.todoistStates.get(notePath) ?? null;
  }
  async setTodoistState(notePath: string, state: TaskData): Promise<void> {
    this.todoistStates.set(notePath, state);
  }
  async removeTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<TaskData[]> {
    return [...this.todoistStates.values()];
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  issues: GithubTaskData[] = [];

  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return this.issues;
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchProjectDetail(): Promise<never> {
    throw new Error('not used in this test');
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
    const task: TodoistTaskData = {
      id,
      projectId: input.projectId,
      sectionId: input.sectionId ?? null,
      parentId: input.parentId ?? null,
      content: input.content,
      labels: input.labels ?? [],
      isCompleted: false,
      url: `https://app.todoist.com/app/task/${id}`,
    };
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
    const task = this.active.find((candidate) => candidate.id === id);
    if (task) {
      task.isCompleted = completed;
    }
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
  todoReturns: string[] = [];
  // The interleaved call order across both surfaces, so the two-phase
  // parents-before-children ordering is directly observable.
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
    const id = `T${++this.counter}`;
    this.todoReturns.push(id);
    return id;
  }
}

function recorder(events: string[], name: string) {
  return {
    execute: async () => {
      events.push(name);
    },
  };
}

function issue(overrides: Partial<GithubTaskData> = {}): GithubTaskData {
  return {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: 'I',
    title: 'Fix the bug',
    body: '',
    state: 'open',
    updatedAt: '2026-09-18T11:00:00Z',
    labels: ['type: task'],
    ...overrides,
  };
}

function status(notePath: string, url: string): TaskData {
  return taskRecord({
    url,
    remoteId: 42,
    notePath,
    body: 'h',
    updatedAt: '2026-09-18T11:00:00Z',
    status: 'Building',
    title: 'Fix the bug',
  });
}

function taskNote(statusName: string, body = '', todoistId?: string): string {
  const lines = [
    '---',
    `url: https://github.com/acme/widgets/issues/42`,
    `status: ${statusName}`,
    'affiliation: ["[[Acme Widgets]]"]',
  ];
  if (todoistId !== undefined) {
    lines.push(`todoist: ${todoistId}`);
  }
  lines.push('---', body);
  return lines.join('\n');
}

// A slice note: a tracked issue of type slice, affiliated to the project.
function sliceNote(url: string, statusName: string): string {
  return [
    '---',
    `url: ${url}`,
    `status: ${statusName}`,
    'affiliation: ["[[Acme Widgets]]"]',
    '---',
    '',
  ].join('\n');
}

// A task note affiliated to a slice (its second affiliation link).
function sliceChildNote(
  url: string,
  statusName: string,
  sliceStem: string,
  body = '',
): string {
  return [
    '---',
    `url: ${url}`,
    `status: ${statusName}`,
    `affiliation: ["[[Acme Widgets]]", "[[${sliceStem}]]"]`,
    '---',
    body,
  ].join('\n');
}

// A to-do note affiliated to its parent task (and optionally a parent to-do).
function toDoNote(taskStem: string, parentToDoStem?: string): string {
  const links = ['"[[Acme Widgets]]"', `"[[${taskStem}]]"`];
  if (parentToDoStem !== undefined) {
    links.push(`"[[${parentToDoStem}]]"`);
  }
  return [
    '---',
    'status: open',
    `affiliation: [${links.join(', ')}]`,
    '---',
    '',
  ].join('\n');
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
      execute: async () => ({ Unshaped: 'S1', Building: 'S2', Shipped: 'S3' }),
    } as unknown as EnsureTodoistSectionsAction,
    writer,
    recorder(
      events,
      'applyRemoteChanges',
    ) as unknown as ApplyTodoistRemoteChangesAction,
    recorder(
      events,
      'captureCreations',
    ) as unknown as CaptureTodoistCreationsAction,
    recorder(
      events,
      'applyCompletion',
    ) as unknown as ApplyTodoistCompletionAction,
    recorder(
      events,
      'propagateDeletions',
    ) as unknown as PropagateTodoistDeletionsAction,
    'Shipped',
  );
  return { action, events };
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
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
  return {
    action,
    events,
    vault,
    syncState,
    projectManagement,
    taskManager,
    writer,
  };
}

// A composed harness: the REAL writer over the fakes, so the two-phase ordering
// and the settle property are observable end to end (the fakes apply the
// anchor and snapshot writes the writer makes).
function composedHarness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
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
  return {
    action,
    events,
    vault,
    syncState,
    projectManagement,
    taskManager,
    writer,
  };
}

const input = {
  projectName: 'Acme Widgets',
  projectId: 'P1',
  syncedAt: '2026-09-18T12:00:00Z',
};

const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

describe('SyncTodoistTasksAction', () => {
  it('absorbs remote changes and captures before projecting, deletions last', async () => {
    // Given — a tracked issue with a task note
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));

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
  });

  it('records the lane map when the sections moved', async () => {
    // Given — a project with no stored lane map
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the lane map is persisted
    expect(h.syncState.projectStateSets).toEqual([
      {
        sections: { Unshaped: 'S1', Building: 'S2', Shipped: 'S3' },
        lastCompletedPoll: input.syncedAt,
      },
    ]);
  });

  it('skips the task projection for a project with no GitHub attach', async () => {
    // Given — a project without a repo url
    const h = harness();
    h.syncState.identity = null;

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — no task is projected
    expect(h.writer.taskCalls).toEqual([]);
  });

  it('nests a child under its slice twin', async () => {
    // Given — a slice and a child affiliated to it
    const h = harness();
    const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
    const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
    const sliceUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    h.projectManagement.issues = [
      issue({
        url: sliceUrl,
        remoteId: 40,
        title: 'The slice',
        labels: ['type: slice'],
      }),
      issue({ url: childUrl, remoteId: 42, title: 'The child' }),
    ];
    h.vault.notes.set(
      slicePath,
      `---\nurl: ${sliceUrl}\nstatus: Building\naffiliation: ["[[Acme Widgets]]"]\n---\n`,
    );
    h.vault.notes.set(
      childPath,
      `---\nurl: ${childUrl}\nstatus: Building\naffiliation: ["[[Acme Widgets]]", "[[40-the-slice]]"]\n---\n`,
    );
    h.syncState.statuses.set(sliceUrl, status(slicePath, sliceUrl));
    h.syncState.statuses.set(childUrl, status(childPath, childUrl));

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the child is placed under the slice's new twin id
    const childCall = h.writer.taskCalls.find(
      (call) => call.task.title === 'The child',
    );
    expect(childCall?.parentId).toBe(h.writer.taskReturns[0]);
  });

  it('projects a to-do linked from a task checklist', async () => {
    // Given — a task with a twin anchor and a linked to-do note
    const h = harness();
    const todoPath = 'Projecten/Acme Widgets/todos/step-one.md';
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(
      taskPath,
      taskNote('Building', `- [ ] [[${todoPath}|Step one]]`, 'T-task'),
    );
    h.vault.notes.set(
      todoPath,
      '---\nstatus: open\naffiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]\n---\n',
    );
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));
    h.vault.folders.set('Projecten/Acme Widgets/taken', [taskPath]);

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the to-do is projected under the task's twin
    expect(h.writer.todoCalls).toHaveLength(1);
    expect(h.writer.todoCalls[0]!.todo.title).toBe('Step one');
    expect(h.writer.todoCalls[0]!.parentId).toBe(h.writer.taskReturns[0]);
  });

  it('swallows a step failure so the GitHub half is never affected', async () => {
    // Given — a remote-absorption step that throws
    const events: string[] = [];
    const action = new SyncTodoistTasksAction(
      new FakeTaskManager(),
      new FakeProjectManagement(),
      new FakeVault(),
      new FakeSyncState(),
      { execute: async () => ({}) } as unknown as EnsureTodoistSectionsAction,
      new FakeWriter() as unknown as ApplyTaskToTodoistAction,
      {
        execute: async () => {
          throw new Error('todoist failed');
        },
      } as unknown as ApplyTodoistRemoteChangesAction,
      recorder(
        events,
        'captureCreations',
      ) as unknown as CaptureTodoistCreationsAction,
      recorder(
        events,
        'applyCompletion',
      ) as unknown as ApplyTodoistCompletionAction,
      recorder(
        events,
        'propagateDeletions',
      ) as unknown as PropagateTodoistDeletionsAction,
      'Shipped',
    );

    // When — the Todoist half runs
    await expect(action.execute(input)).resolves.toBeUndefined();

    // Then — no later step ran and the failure did not propagate
    expect(events).toEqual([]);
  });
});

describe('SyncTodoistTasksAction creation order', () => {
  const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
  const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
  const stepPath = 'Projecten/Acme Widgets/todos/step-one.md';
  const sliceUrl = 'https://github.com/acme/widgets/issues/40';
  const childUrl = 'https://github.com/acme/widgets/issues/42';
  const takenFolder = 'Projecten/Acme Widgets/taken';

  it('#61: creates the missing parent twin before wiring its to-do', async () => {
    // Given — a tracked task whose twin record is missing (a stale anchor is
    // all that remains) and a to-do linked from its checklist
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(
      taskPath,
      taskNote('Building', `- [ ] [[${stepPath}|Step one]]`, 'T-stale'),
    );
    h.vault.notes.set(stepPath, toDoNote('42-fix-the-bug'));
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));
    h.vault.folders.set(takenFolder, [taskPath]);

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — phase A creates the parent twin top-level
    expect(h.writer.taskCalls).toHaveLength(1);
    expect(h.writer.taskCalls[0]!.parentId).toBeNull();
    expect(h.writer.taskCalls[0]!.sectionId).toBe('S2');

    // And — phase B wires the to-do to that freshly created twin, never the
    // stale anchor
    expect(h.writer.todoCalls).toHaveLength(1);
    expect(h.writer.todoCalls[0]!.parentId).toBe(h.writer.taskReturns[0]);
    expect(h.writer.todoCalls[0]!.parentId).not.toBe('T-stale');

    // And — the parent create strictly precedes the to-do, so the parent twin
    // the to-do hangs off cannot be missing mid-pass
    expect(h.writer.order).toEqual(['task:Fix the bug', 'todo:Step one']);

    // And — no to-do create ever reaches Todoist without a real parent twin
    for (const call of h.writer.todoCalls) {
      expect(h.writer.taskReturns).toContain(call.parentId);
    }
  });

  it('rebuilds a whole slice tree in one pass from an empty twin store', async () => {
    // Given — an empty todoistItem namespace and a full vault tree: a slice,
    // its child task, and the child's to-do
    const h = harness();
    h.projectManagement.issues = [
      issue({
        url: sliceUrl,
        remoteId: 40,
        title: 'The slice',
        labels: ['type: slice'],
      }),
      issue({ url: childUrl, remoteId: 42, title: 'The child' }),
    ];
    h.vault.notes.set(slicePath, sliceNote(sliceUrl, 'Building'));
    h.vault.notes.set(
      childPath,
      sliceChildNote(
        childUrl,
        'Building',
        '40-the-slice',
        `- [ ] [[${stepPath}|Step one]]`,
      ),
    );
    h.vault.notes.set(stepPath, toDoNote('42-the-child'));
    h.syncState.statuses.set(sliceUrl, status(slicePath, sliceUrl));
    h.syncState.statuses.set(childUrl, status(childPath, childUrl));
    h.vault.folders.set(takenFolder, [slicePath, childPath]);

    // When — one pass runs
    await h.action.execute(input);

    // Then — the slice is top-level, the child hangs off the slice, and the
    // to-do hangs off the child, each parent resolved from the twin just created
    expect(h.writer.taskCalls.map((call) => call.task.title)).toEqual([
      'The slice',
      'The child',
    ]);
    expect(h.writer.taskCalls[0]!.parentId).toBeNull();
    expect(h.writer.taskCalls[1]!.parentId).toBe(h.writer.taskReturns[0]);
    expect(h.writer.todoCalls).toHaveLength(1);
    expect(h.writer.todoCalls[0]!.parentId).toBe(h.writer.taskReturns[1]);

    // And — the slice (phase A) precedes its child (phase B), which precedes
    // the to-do (phase B, after every task twin exists)
    expect(h.writer.order).toEqual([
      'task:The slice',
      'task:The child',
      'todo:Step one',
    ]);
  });

  it('creates a standalone task top-level with no parent', async () => {
    // Given — a tracked task with no slice affiliation and no twin
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the task is top-level with no parent
    expect(h.writer.taskCalls).toHaveLength(1);
    expect(h.writer.taskCalls[0]!.parentId).toBeNull();
  });

  it('creates a slice-member task under the slice twin', async () => {
    // Given — a slice and a child affiliated to it
    const h = harness();
    h.projectManagement.issues = [
      issue({
        url: sliceUrl,
        remoteId: 40,
        title: 'The slice',
        labels: ['type: slice'],
      }),
      issue({ url: childUrl, remoteId: 42, title: 'The child' }),
    ];
    h.vault.notes.set(slicePath, sliceNote(sliceUrl, 'Building'));
    h.vault.notes.set(
      childPath,
      sliceChildNote(childUrl, 'Building', '40-the-slice'),
    );
    h.syncState.statuses.set(sliceUrl, status(slicePath, sliceUrl));
    h.syncState.statuses.set(childUrl, status(childPath, childUrl));

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the child hangs off the slice's twin
    expect(h.writer.taskCalls[1]!.parentId).toBe(h.writer.taskReturns[0]);
  });

  it('settles: a second pass writes nothing on any surface', async () => {
    // Given — a clean tree rebuilt in one pass by the real writer
    const h = composedHarness();
    h.projectManagement.issues = [
      issue({
        url: sliceUrl,
        remoteId: 40,
        title: 'The slice',
        labels: ['type: slice'],
      }),
      issue({ url: childUrl, remoteId: 42, title: 'The child' }),
    ];
    h.vault.notes.set(slicePath, sliceNote(sliceUrl, 'Building'));
    h.vault.notes.set(
      childPath,
      sliceChildNote(
        childUrl,
        'Building',
        '40-the-slice',
        `- [ ] [[${stepPath}|Step one]]`,
      ),
    );
    h.vault.notes.set(stepPath, toDoNote('42-the-child'));
    h.syncState.statuses.set(sliceUrl, status(slicePath, sliceUrl));
    h.syncState.statuses.set(childUrl, status(childPath, childUrl));
    h.vault.folders.set(takenFolder, [slicePath, childPath]);

    await h.action.execute(input);
    expect(h.taskManager.createTaskCalls).toHaveLength(3);

    // When — a second pass runs with no external change
    await h.action.execute(input);

    // Then — nothing is created, updated, moved or completed again
    expect(h.taskManager.createTaskCalls).toHaveLength(3);
    expect(h.taskManager.updateTaskCalls).toEqual([]);
    expect(h.taskManager.moveTaskCalls).toEqual([]);
    expect(h.taskManager.completeCalls).toEqual([]);
  });

  it('never creates a top-level to-do whose parent twin cannot exist', async () => {
    // Given — a to-do linked from a task note that is not tracked and carries
    // only a stale anchor, so no twin can exist after the task projection. The
    // real writer is composed so a create would reach the Todoist fake.
    const h = composedHarness();
    h.projectManagement.issues = [];
    h.vault.notes.set(
      taskPath,
      taskNote('Building', `- [ ] [[${stepPath}|Step one]]`, 'T-stale'),
    );
    h.vault.notes.set(stepPath, toDoNote('42-fix-the-bug'));
    h.vault.folders.set(takenFolder, [taskPath]);

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the to-do is skipped: Todoist receives no create, so it can never
    // be materialised as a top-level task by capture
    expect(h.taskManager.createTaskCalls).toEqual([]);
    expect(h.taskManager.ensureLabelCalls).toEqual([]);
  });

  it('#61 composed: stamps the to-do record with the real parent twin', async () => {
    // Given — a tracked task whose twin record is missing and a to-do linked
    // from its checklist, through the real writer
    const h = composedHarness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(
      taskPath,
      taskNote('Building', `- [ ] [[${stepPath}|Step one]]`, 'T-stale'),
    );
    h.vault.notes.set(stepPath, toDoNote('42-fix-the-bug'));
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));
    h.vault.folders.set(takenFolder, [taskPath]);

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the parent twin is top-level and the to-do is its child
    const parent = h.taskManager.active.find(
      (task) => task.content === 'Fix the bug',
    )!;
    const todo = h.taskManager.active.find(
      (task) => task.content === 'Step one',
    )!;
    expect(parent.parentId).toBeNull();
    expect(todo.parentId).toBe(parent.id);

    // And — the to-do's snapshot record carries the real parent twin id, so the
    // next poll cannot read it as a top-level item
    expect(h.syncState.todoistStates.get(stepPath)!.parent).toBe(parent.id);
    expect(h.syncState.todoistStates.get(taskPath)!.parent).toBeNull();

    // And — the stale anchor was replaced by the newly created twin id
    expect(h.vault.notes.get(taskPath)).toContain(`todoist: ${parent.id}`);
  });
});

describe('SyncTodoistTasksAction checklist link resolution', () => {
  const bareStem = 'note-edit-step-one';
  const todoPath = `Projecten/Acme Widgets/todos/${bareStem}.md`;
  const takenFolder = 'Projecten/Acme Widgets/taken';

  it('resolves a legacy bare wikilink to the to-do note in todos/', async () => {
    // Given — a tracked task whose checklist links its to-do by a bare stem
    // (no folder, no .md) and the to-do note in the project's todos/ folder
    const h = composedHarness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(
      taskPath,
      taskNote('Building', `- [ ] [[${bareStem}|Step one]]`),
    );
    h.vault.notes.set(todoPath, toDoNote('42-fix-the-bug'));
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));
    h.vault.folders.set(takenFolder, [taskPath]);

    // When — one pass runs
    await h.action.execute(input);

    // Then — exactly one task twin and one to-do twin exist
    expect(h.taskManager.createTaskCalls).toHaveLength(2);

    // And — the to-do hangs off the task's twin
    const parent = h.taskManager.active.find(
      (task) => task.content === 'Fix the bug',
    )!;
    const todoTwin = h.taskManager.active.find(
      (task) => task.content === 'Step one',
    )!;
    expect(todoTwin.parentId).toBe(parent.id);

    // And — the record is keyed by the REAL todos/ path, never the bare stem
    expect(h.syncState.todoistStates.get(todoPath)!.parent).toBe(parent.id);
    expect(h.syncState.todoistStates.get(todoPath)!.completed).toBe(false);
    expect(h.syncState.todoistStates.has(bareStem)).toBe(false);

    // And — the frontmatter anchor is stamped on the real note, never the stem
    expect(h.vault.notes.get(todoPath)).toContain(`todoist: ${todoTwin.id}`);
    expect(h.vault.notes.has(bareStem)).toBe(false);
  });

  it('settles a completed to-do across ticks', async () => {
    // Given — a tracked task whose to-do is already completed in the vault
    const h = composedHarness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(
      taskPath,
      taskNote('Building', `- [ ] [[${bareStem}|Step one]]`),
    );
    h.vault.notes.set(
      todoPath,
      '---\nstatus: completed\ncompleted: 2026-09-18T12:00:00Z\naffiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]\n---\n',
    );
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));
    h.vault.folders.set(takenFolder, [taskPath]);

    // When — the first tick runs
    await h.action.execute(input);
    const created = h.taskManager.createTaskCalls.length;
    const completed = h.taskManager.completeCalls.length;
    expect(created).toBe(2);
    expect(completed).toBe(1);
    expect(h.syncState.todoistStates.get(todoPath)!.completed).toBe(true);

    // And — the completed twin leaves the active set; the completed-since
    // window owns it from here on, so it is absent from every later probe
    const todoTwin = h.taskManager.active.find(
      (task) => task.content === 'Step one',
    )!;
    h.taskManager.active = h.taskManager.active.filter(
      (task) => task.id !== todoTwin.id,
    );
    const todoRecord = h.syncState.todoistStates.get(todoPath);
    const taskRecord = h.syncState.todoistStates.get(taskPath);
    const todoContent = h.vault.notes.get(todoPath);

    // When — two more ticks run
    await h.action.execute(input);
    await h.action.execute(input);

    // Then — nothing is created, written or completed again
    expect(h.taskManager.createTaskCalls).toHaveLength(created);
    expect(h.taskManager.completeCalls).toHaveLength(completed);
    expect(h.taskManager.updateTaskCalls).toEqual([]);
    expect(h.taskManager.moveTaskCalls).toEqual([]);
    expect(h.syncState.todoistStates.get(todoPath)).toBe(todoRecord);
    expect(h.syncState.todoistStates.get(taskPath)).toBe(taskRecord);
    expect(h.vault.notes.get(todoPath)).toBe(todoContent);
  });

  it('ignores a leftover note at the bare stem outside todos/', async () => {
    // Given — a bare checklist link, a decoy note at the bare stem in the vault
    // root, and the real to-do note in todos/
    const h = composedHarness();
    const decoy = toDoNote('42-fix-the-bug');
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(
      taskPath,
      taskNote('Building', `- [ ] [[${bareStem}|Step one]]`),
    );
    h.vault.notes.set(bareStem, decoy);
    h.vault.notes.set(todoPath, toDoNote('42-fix-the-bug'));
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));
    h.vault.folders.set(takenFolder, [taskPath]);

    // When — one pass runs
    await h.action.execute(input);

    // Then — the to-do is keyed by and projected from the todos/ note only
    const todoTwin = h.taskManager.active.find(
      (task) => task.content === 'Step one',
    )!;
    expect(h.syncState.todoistStates.get(todoPath)!.todoistId).toBe(
      todoTwin.id,
    );
    expect(h.syncState.todoistStates.has(bareStem)).toBe(false);

    // And — the decoy at the bare stem is never written to; the anchor lands
    // on the real note
    expect(h.vault.notes.get(bareStem)).toBe(decoy);
    expect(h.vault.notes.get(todoPath)).toContain(`todoist: ${todoTwin.id}`);
  });
});
