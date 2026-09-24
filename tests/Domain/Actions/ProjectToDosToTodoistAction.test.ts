import { describe, expect, it } from 'vitest';
import { ProjectToDosToTodoistAction } from '../../../src/Domain/Actions/ProjectToDosToTodoistAction.js';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistStateData } from '../../../src/Domain/DataTransferObjects/TodoistStateData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the vault holds the task and to-do notes and records
// writes, the task manager holds the project's active tasks and records every
// mutation, and the sync state holds the per-note Todoist bookkeeping. The
// projection's shape decisions and its completion push are what's under test,
// and the fakes' real mutation is what makes idempotency observable.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  files: string[] = [];
  writes: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.notes.set(path, content);
  }
  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return this.files.filter((path) => path.startsWith(prefix));
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
  tasks: TodoistTaskData[] = [];
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

  async fetchActiveTasks(projectId: string): Promise<TodoistTaskData[]> {
    return this.tasks.filter(
      (task) => task.projectId === projectId && !task.isCompleted,
    );
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
    this.tasks.push(task);
    return task;
  }
  async updateTask(
    id: string,
    input: { content: string; labels: string[] },
  ): Promise<void> {
    this.updateTaskCalls.push({ id, ...input });
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (task) {
      task.content = input.content;
      task.labels = input.labels;
    }
  }
  async moveTask(
    id: string,
    to: { sectionId?: string; parentId?: string },
  ): Promise<void> {
    this.moveTaskCalls.push({ id, to });
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (task && to.parentId !== undefined) {
      task.parentId = to.parentId;
    }
  }
  async setTaskCompleted(id: string, completed: boolean): Promise<void> {
    this.completeCalls.push({ id, completed });
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (task) {
      task.isCompleted = completed;
    }
  }
  async ensureLabel(name: string): Promise<void> {
    this.ensureLabelCalls.push(name);
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
  async fetchSections(): Promise<never> {
    throw new Error('not used in this test');
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
  async deleteTask(): Promise<never> {
    throw new Error('not used in this test');
  }
}

class FakeSyncState implements SyncStatePort {
  todoistItemStates = new Map<string, TodoistStateData>();
  todoistItemSets: Array<{ notePath: string; state: TodoistStateData }> = [];

  async getTodoistState(notePath: string): Promise<TodoistStateData | null> {
    return this.todoistItemStates.get(notePath) ?? null;
  }
  async setTodoistState(
    notePath: string,
    state: TodoistStateData,
  ): Promise<void> {
    this.todoistItemSets.push({ notePath, state });
    this.todoistItemStates.set(notePath, state);
  }
  async listTodoistStates(): Promise<TodoistStateData[]> {
    return [...this.todoistItemStates.values()];
  }

  async get(): Promise<Status | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return [];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<null> {
    return null;
  }
  async getLastProjectUpdate(): Promise<null> {
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
    return null;
  }
  async setTodoistProjectState(): Promise<void> {}
}

const projectName = 'Acme Widgets';
const projectId = 'P1';
const syncedAt = '2026-09-24T12:00:00Z';

const taskPath = 'Projecten/Acme Widgets/taken/41-chore-1.md';
const todoPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';
const parentTodoPath = 'Projecten/Acme Widgets/todos/9-parent.md';
const childTodoPath = 'Projecten/Acme Widgets/todos/10-child.md';

// A task note carrying its Todoist twin anchor and a markdown checklist.
function taskNote(twinId: string, lines: string[]): string {
  return [
    '---',
    `todoist: ${twinId}`,
    'status: Unshaped',
    '---',
    ...lines,
  ].join('\n');
}

// A to-do note: the affiliation lists the project, the parent task and — when
// nested — the parent to-do, each a quoted wikilink.
function todoNote(status: string, affiliation: string[]): string {
  return [
    '---',
    'categories: ["[[Todos.base|Todos]]"]',
    `affiliation: [${affiliation.map((link) => `"${link}"`).join(', ')}]`,
    `status: ${status}`,
    'completed:',
    '---',
    '',
  ].join('\n');
}

function task(
  id: string,
  parentId: string | null,
  content: string,
  labels: string[],
  isCompleted = false,
): TodoistTaskData {
  return {
    id,
    projectId,
    sectionId: null,
    parentId,
    content,
    labels,
    isCompleted,
    url: `https://app.todoist.com/app/task/${id}`,
  };
}

function state(
  todoistId: string,
  notePath: string,
  lastSyncedCompleted: boolean,
): TodoistStateData {
  return {
    todoistId,
    notePath,
    lastSyncedHash: 'stale',
    lastSyncedCompleted,
  };
}

function setup() {
  const vault = new FakeVault();
  const taskManager = new FakeTaskManager();
  const syncState = new FakeSyncState();
  const action = new ProjectToDosToTodoistAction(taskManager, vault, syncState);
  return { action, vault, taskManager, syncState };
}

// Seeds one tracked task whose twin is T1, with a linked to-do.
function seedLinkedToDo(
  vault: FakeVault,
  status = 'open',
  affiliation = ['[[Acme Widgets]]', '[[41-chore-1]]'],
): void {
  vault.files.push(taskPath);
  vault.notes.set(
    taskPath,
    taskNote('TASK', [`- [ ] [[${todoPath}|Fix the widget]]`]),
  );
  vault.notes.set(todoPath, todoNote(status, affiliation));
}

describe('ProjectToDosToTodoistAction', () => {
  it('projects a linked to-do as a todo-labeled subtask under its task twin', async () => {
    // Given — a tracked task with a twin and a linked to-do
    const { action, vault, taskManager, syncState } = setup();
    seedLinkedToDo(vault);

    // When — the to-dos are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the to-do is a subtask of the task twin, labeled todo
    expect(taskManager.createTaskCalls).toEqual([
      {
        projectId,
        parentId: 'TASK',
        content: 'Fix the widget',
        labels: ['todo'],
      },
    ]);
    // And the label was ensured before use
    expect(taskManager.ensureLabelCalls).toEqual(['todo']);
    // And the to-do note carries its twin's anchor
    expect(vault.notes.get(todoPath)).toContain('todoist: T1');
    // And the snapshot is stamped with the completion bit
    expect(syncState.todoistItemSets).toEqual([
      {
        notePath: todoPath,
        state: {
          todoistId: 'T1',
          notePath: todoPath,
          lastSyncedHash: expect.any(String),
          lastSyncedCompleted: false,
          lastSyncedContent: 'Fix the widget',
          lastSyncedLane: null,
          lastSyncedParent: 'TASK',
        },
      },
    ]);
  });

  it('does not project an unlinked checklist item', async () => {
    // Given — a task twin whose checklist line carries no to-do link
    const { action, vault, taskManager } = setup();
    vault.files.push(taskPath);
    vault.notes.set(taskPath, taskNote('T1', ['- [ ] Just a loose note']));

    // When — the to-dos are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — nothing is created
    expect(taskManager.createTaskCalls).toEqual([]);
  });

  it('does not project a to-do whose task has no twin', async () => {
    // Given — a task note with no `todoist` anchor and a linked to-do
    const { action, vault, taskManager } = setup();
    vault.files.push(taskPath);
    vault.notes.set(
      taskPath,
      ['---', 'status: Unshaped', '---', `- [ ] [[${todoPath}|Fix]]`].join(
        '\n',
      ),
    );
    vault.notes.set(
      todoPath,
      todoNote('open', ['[[Acme Widgets]]', '[[41-chore-1]]']),
    );

    // When — the to-dos are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the to-do does not project, because its task has no twin
    expect(taskManager.createTaskCalls).toEqual([]);
  });

  it('nests a to-do under its parent to-do twin at the fourth indent level', async () => {
    // Given — a task twin with a parent to-do and a to-do nested under it
    const { action, vault, taskManager } = setup();
    vault.files.push(taskPath);
    vault.notes.set(
      taskPath,
      taskNote('TASK', [
        `- [ ] [[${parentTodoPath}|Parent]]`,
        `- [ ] [[${childTodoPath}|Child]]`,
      ]),
    );
    vault.notes.set(
      parentTodoPath,
      todoNote('open', ['[[Acme Widgets]]', '[[41-chore-1]]']),
    );
    vault.notes.set(
      childTodoPath,
      todoNote('open', ['[[Acme Widgets]]', '[[41-chore-1]]', '[[9-parent]]']),
    );

    // When — the to-dos are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the parent sits under the task, the child under the parent
    expect(taskManager.createTaskCalls[0]).toEqual({
      projectId,
      parentId: 'TASK',
      content: 'Parent',
      labels: ['todo'],
    });
    expect(taskManager.createTaskCalls[1]).toEqual({
      projectId,
      parentId: 'T1',
      content: 'Child',
      labels: ['todo'],
    });
  });

  it('closes the twin when the vault to-do is completed', async () => {
    // Given — a completed to-do whose twin is active
    const { action, vault, taskManager, syncState } = setup();
    seedLinkedToDo(vault, 'completed');
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, false));
    taskManager.tasks.push(task('T2', 'TASK', 'Fix the widget', ['todo']));

    // When — the to-dos are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the twin is closed
    expect(taskManager.completeCalls).toEqual([{ id: 'T2', completed: true }]);
  });

  it('reopens the twin when the vault to-do is reopened', async () => {
    // Given — an open to-do whose twin is completed (absent from the active
    // set) and whose snapshot said completed
    const { action, vault, taskManager, syncState } = setup();
    seedLinkedToDo(vault, 'open');
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, true));
    taskManager.tasks.push(
      task('T2', 'TASK', 'Fix the widget', ['todo'], true),
    );

    // When — the to-dos are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the twin is reopened
    expect(taskManager.completeCalls).toEqual([{ id: 'T2', completed: false }]);
  });

  it('leaves a remote reopen to the apply action', async () => {
    // Given — a completed to-do whose snapshot said completed but whose twin
    // is active again (a remote reopen)
    const { action, vault, taskManager, syncState } = setup();
    seedLinkedToDo(vault, 'completed');
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, true));
    taskManager.tasks.push(task('T2', 'TASK', 'Fix the widget', ['todo']));

    // When — the to-dos are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the projection does not clobber the reopen; nothing is written
    expect(taskManager.completeCalls).toEqual([]);
    expect(syncState.todoistItemSets).toEqual([]);
  });

  it('overwrites content, label and parent drift on the twin', async () => {
    // Given — a twin whose content, labels and parent drifted
    const { action, vault, taskManager, syncState } = setup();
    seedLinkedToDo(vault);
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, false));
    taskManager.tasks.push(task('T2', null, 'Old title', ['wrong']));

    // When — the to-dos are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the derived shape replaces the drift
    expect(taskManager.updateTaskCalls).toEqual([
      { id: 'T2', content: 'Fix the widget', labels: ['todo'] },
    ]);
    expect(taskManager.moveTaskCalls).toEqual([
      { id: 'T2', to: { parentId: 'TASK' } },
    ]);
  });

  it('is idempotent: a second pass over a settled project writes nothing', async () => {
    // Given — a project projected once
    const { action, vault, taskManager } = setup();
    seedLinkedToDo(vault);
    await action.execute({ projectName, projectId, syncedAt });
    taskManager.createTaskCalls = [];
    taskManager.updateTaskCalls = [];
    taskManager.moveTaskCalls = [];
    taskManager.completeCalls = [];
    taskManager.ensureLabelCalls = [];

    // When — the same project is projected again
    await action.execute({ projectName, projectId, syncedAt });

    // Then — no Todoist write is made
    expect(taskManager.createTaskCalls).toEqual([]);
    expect(taskManager.updateTaskCalls).toEqual([]);
    expect(taskManager.moveTaskCalls).toEqual([]);
    expect(taskManager.completeCalls).toEqual([]);
    expect(taskManager.ensureLabelCalls).toEqual([]);
  });
});
