import { describe, expect, it } from 'vitest';
import { CaptureTodoistCreationsAction } from '../../../src/Domain/Actions/CaptureTodoistCreationsAction.js';
import { splitFrontmatter } from '../../../src/Domain/Notes/splitFrontmatter.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

// Fakes at the ports: the vault holds note content and records creations and
// writes; the task manager serves the fetched active/completed sets (and would
// throw if the action ever wrote back to Todoist); the sync state holds the
// per-item bookkeeping and the lane map. The kind classification and the
// captured note shape are what's under test.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  writes: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(path: string, content: string): Promise<void> {
    this.created.push({ path, content });
    this.notes.set(path, content);
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.notes.set(path, content);
  }
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(): Promise<string[]> {
    return [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeTaskManager implements TaskManagerPort {
  active: TodoistTaskData[] = [];
  completed: TodoistTaskData[] = [];

  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
    return this.active;
  }
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    return this.completed;
  }

  async fetchProjects(): Promise<TodoistProjectData[]> {
    return [];
  }
  async fetchProject(): Promise<null> {
    return null;
  }
  async createProject(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async updateProject(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async setProjectArchived(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async fetchSections(): Promise<TodoistSectionData[]> {
    return [];
  }
  async createSection(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async updateSection(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async createTask(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async updateTask(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async moveTask(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async setTaskCompleted(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async deleteTask(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async ensureLabel(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
}

class FakeSyncState implements SyncStatePort {
  identity: ProjectIdentityData | null = null;
  projectState: TodoistProjectStateData | null = null;
  todoistItemStates = new Map<string, TaskData>();
  todoistItemSets: Array<{ notePath: string; state: TaskData }> = [];

  async getTodoistProjectState(): Promise<TodoistProjectStateData | null> {
    return this.projectState;
  }
  async setTodoistProjectState(): Promise<void> {}
  async getTodoistState(notePath: string): Promise<TaskData | null> {
    return this.todoistItemStates.get(notePath) ?? null;
  }
  async setTodoistState(notePath: string, state: TaskData): Promise<void> {
    this.todoistItemSets.push({ notePath, state });
    this.todoistItemStates.set(notePath, state);
  }
  async listTodoistStates(): Promise<TaskData[]> {
    return [...this.todoistItemStates.values()];
  }
  async removeTodoistState(notePath: string): Promise<void> {
    this.todoistItemStates.delete(notePath);
  }

  async get(): Promise<TaskData | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<TaskData | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<TaskData[]> {
    return [];
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
}

const projectName = 'Acme Widgets';
const projectId = 'P1';
const syncedAt = '2026-09-24T12:00:00Z';
const doneOptionName = 'Shipped';

const identity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [
    { id: 'PVTSSF_1', name: 'Unshaped' },
    { id: 'PVTSSF_2', name: 'Building' },
    { id: 'PVTSSF_3', name: 'Shipped' },
  ],
};

const sections = { Unshaped: 'S1', Building: 'S2', Shipped: 'S3' };

function twin(
  id: string,
  content: string,
  overrides: Partial<TodoistTaskData> = {},
): TodoistTaskData {
  return {
    id,
    projectId,
    sectionId: null,
    parentId: null,
    content,
    labels: [],
    isCompleted: false,
    url: `https://app.todoist.com/app/task/${id}`,
    ...overrides,
  };
}

function taskNote(
  body: string,
  affiliation: string[] = ['[[Acme Widgets]]'],
  todoistId = 'TASK',
): string {
  return [
    '---',
    'url: https://github.com/acme/widgets/issues/42',
    'status: Unshaped',
    `affiliation: [${affiliation.map((link) => `"${link}"`).join(', ')}]`,
    `todoist: ${todoistId}`,
    '---',
    body,
  ].join('\n');
}

function todoNote(affiliation: string[], todoistId: string): string {
  return [
    '---',
    'categories: ["[[Todos.base|Todos]]"]',
    `affiliation: [${affiliation.map((link) => `"${link}"`).join(', ')}]`,
    'status: open',
    'completed:',
    `todoist: ${todoistId}`,
    '---',
    '',
  ].join('\n');
}

function state(notePath: string, todoistId: string): TaskData {
  return taskRecord({ todoistId, notePath });
}

function bodyOf(content: string): string {
  return splitFrontmatter(content)?.body ?? content;
}

function setup() {
  const vault = new FakeVault();
  const taskManager = new FakeTaskManager();
  const syncState = new FakeSyncState();
  syncState.identity = identity;
  syncState.projectState = {
    sections,
    lastCompletedPoll: '2026-09-24T11:00:00Z',
  };
  const action = new CaptureTodoistCreationsAction(
    taskManager,
    vault,
    syncState,
    'Templates/ToDo.md',
    doneOptionName,
  );
  return { action, vault, taskManager, syncState };
}

describe('CaptureTodoistCreationsAction', () => {
  it('captures a top-level task as a draft affiliated to the project', async () => {
    // Given — a new top-level Todoist task in the Building section
    const { action, vault, taskManager, syncState } = setup();
    taskManager.active = [twin('T1', 'Buy milk', { sectionId: 'S2' })];

    // When — the creations are captured
    await action.execute({ projectName, projectId, syncedAt });

    // Then — a draft task note is created, with no url and no issue
    const path = 'Projecten/Acme Widgets/taken/buy-milk.md';
    const content = vault.notes.get(path)!;
    expect(content).toContain('status: Building');
    expect(content).toContain('affiliation: ["[[Acme Widgets]]"]');
    expect(content).toContain('todoist: T1');
    expect(content).not.toContain('url:');
    // And the snapshot is stamped with the lane and no parent
    expect(syncState.todoistItemSets).toEqual([
      {
        notePath: path,
        state: taskRecord({
          url: '',
          remoteId: 0,
          todoistId: 'T1',
          notePath: path,
          title: 'Buy milk',
          status: 'Building',
        }),
      },
    ]);
  });

  it('captures a section-less task in the default lane', async () => {
    // Given — a new top-level task with no section
    const { action, vault, taskManager } = setup();
    taskManager.active = [twin('T1', 'Buy milk')];

    // When — the creations are captured
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the note lands in the default lane
    const content = vault.notes.get(
      'Projecten/Acme Widgets/taken/buy-milk.md',
    )!;
    expect(content).toContain('status: Unshaped');
  });

  it("captures a subtask under a slice's twin as a slice-affiliated draft", async () => {
    // Given — a slice twin and a new subtask under it
    const { action, vault, taskManager, syncState } = setup();
    const slicePath = 'Projecten/Acme Widgets/taken/40-slice-1.md';
    vault.notes.set(
      slicePath,
      taskNote('Body.', ['[[Acme Widgets]]'], 'SLICE'),
    );
    syncState.todoistItemStates.set(slicePath, state(slicePath, 'SLICE'));
    taskManager.active = [
      twin('SLICE', 'Slice 1', { labels: ['slice'] }),
      twin('T2', 'Write the copy', { parentId: 'SLICE' }),
    ];

    // When — the creations are captured
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the child is a draft affiliated to the slice, in the default lane
    const path = 'Projecten/Acme Widgets/taken/write-the-copy.md';
    const content = vault.notes.get(path)!;
    expect(content).toContain(
      'affiliation: ["[[Acme Widgets]]", "[[40-slice-1]]"]',
    );
    expect(content).toContain('status: Unshaped');
    expect(content).toContain('todoist: T2');
    // And its lane is not controlled (a subtask inherits its parent's)
    expect(syncState.todoistItemSets[0]!.state.status).toBe('');
    expect(syncState.todoistItemSets[0]!.state.parent).toBe('SLICE');
  });

  it("captures a subtask under a task's twin as a linked to-do", async () => {
    // Given — a task twin and a new subtask under it
    const { action, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Body.', ['[[Acme Widgets]]'], 'TASK'));
    syncState.todoistItemStates.set(taskPath, state(taskPath, 'TASK'));
    taskManager.active = [
      twin('TASK', 'Chore 1', { labels: ['chore'] }),
      twin('T7', 'Fix the widget', { parentId: 'TASK' }),
    ];

    // When — the creations are captured
    await action.execute({ projectName, projectId, syncedAt });

    // Then — a to-do note is created and linked from the task's checklist
    const todoPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';
    const todo = vault.notes.get(todoPath)!;
    expect(todo).toContain('status: open');
    expect(todo).toContain(
      'affiliation: ["[[Acme Widgets]]", "[[42-chore-1]]"]',
    );
    expect(todo).toContain('todoist: T7');
    expect(bodyOf(vault.notes.get(taskPath)!)).toContain(
      `- [ ] [[${todoPath}|Fix the widget]]`,
    );
    // And the to-do's snapshot carries the task twin as its parent
    expect(syncState.todoistItemSets[0]!.state.parent).toBe('TASK');
  });

  it("captures a subtask under a to-do's twin as a nested to-do", async () => {
    // Given — a to-do note and a new subtask under its twin
    const { action, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    const parentTodoPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';
    vault.notes.set(taskPath, taskNote('Body.', ['[[Acme Widgets]]'], 'TASK'));
    vault.notes.set(
      parentTodoPath,
      todoNote(['[[Acme Widgets]]', '[[42-chore-1]]'], 'T7'),
    );
    syncState.todoistItemStates.set(taskPath, state(taskPath, 'TASK'));
    syncState.todoistItemStates.set(
      parentTodoPath,
      state(parentTodoPath, 'T7'),
    );
    taskManager.active = [
      twin('T7', 'Fix the widget', { parentId: 'TASK' }),
      twin('T8', 'And then test it', { parentId: 'T7' }),
    ];

    // When — the creations are captured
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the nested to-do carries the parent to-do as its third link
    const nestedPath = 'Projecten/Acme Widgets/todos/and-then-test-it.md';
    expect(vault.notes.get(nestedPath)).toContain(
      'affiliation: ["[[Acme Widgets]]", "[[42-chore-1]]", "[[fix-the-widget]]"]',
    );
    // And the line is linked from the task's checklist
    expect(bodyOf(vault.notes.get(taskPath)!)).toContain(
      `[[${nestedPath}|And then test it]]`,
    );
  });

  it('captures an already-completed item as a done note', async () => {
    // Given — a completed top-level task and a completed subtask
    const { action, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Body.', ['[[Acme Widgets]]'], 'TASK'));
    syncState.todoistItemStates.set(taskPath, state(taskPath, 'TASK'));
    taskManager.completed = [
      twin('T1', 'Already done', { isCompleted: true }),
      twin('T2', 'Done too', { parentId: 'TASK', isCompleted: true }),
    ];

    // When — the creations are captured
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the top-level capture sits in the done lane
    const doneTask = vault.notes.get(
      'Projecten/Acme Widgets/taken/already-done.md',
    )!;
    expect(doneTask).toContain('status: Shipped');
    // And the to-do capture is completed with a full ISO stamp
    const doneTodo = vault.notes.get(
      'Projecten/Acme Widgets/todos/done-too.md',
    )!;
    expect(doneTodo).toContain('status: completed');
    expect(doneTodo).toContain(`completed: ${syncedAt}`);
    expect(syncState.todoistItemSets[1]!.state.completed).toBe(true);
  });

  it('does not re-capture an already-anchored item', async () => {
    // Given — an item whose note is already anchored
    const { action, vault, taskManager, syncState } = setup();
    const path = 'Projecten/Acme Widgets/taken/buy-milk.md';
    vault.notes.set(path, taskNote('Body.', ['[[Acme Widgets]]'], 'T1'));
    syncState.todoistItemStates.set(path, state(path, 'T1'));
    taskManager.active = [twin('T1', 'Buy milk')];

    // When — the creations are captured
    await action.execute({ projectName, projectId, syncedAt });

    // Then — nothing is created and nothing is re-stamped
    expect(vault.created).toEqual([]);
    expect(syncState.todoistItemSets).toEqual([]);
  });

  it('captures a parent and its child in one pass, parent first', async () => {
    // Given — a new top-level task and a subtask under it
    const { action, vault, taskManager, syncState } = setup();
    taskManager.active = [
      twin('T9', 'New parent'),
      twin('T2', 'New child', { parentId: 'T9' }),
    ];

    // When — the creations are captured
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the parent becomes a draft and the child a to-do linked to it
    const parentPath = 'Projecten/Acme Widgets/taken/new-parent.md';
    const childPath = 'Projecten/Acme Widgets/todos/new-child.md';
    expect(vault.notes.has(parentPath)).toBe(true);
    expect(vault.notes.get(childPath)).toContain(
      'affiliation: ["[[Acme Widgets]]", "[[new-parent]]"]',
    );
    expect(bodyOf(vault.notes.get(parentPath)!)).toContain(
      `[[${childPath}|New child]]`,
    );
    expect(syncState.todoistItemSets).toHaveLength(2);
  });

  it('waits for a child whose parent is not in the fetched set', async () => {
    // Given — a subtask whose parent twin is not fetched at all
    const { action, vault, taskManager } = setup();
    taskManager.active = [twin('T2', 'Orphan', { parentId: 'GONE' })];

    // When — the creations are captured
    await action.execute({ projectName, projectId, syncedAt });

    // Then — nothing is created for the orphaned child
    expect(vault.created).toEqual([]);
  });
});
