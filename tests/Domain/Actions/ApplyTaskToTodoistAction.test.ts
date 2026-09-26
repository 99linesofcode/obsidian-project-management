import { describe, expect, it } from 'vitest';
import { ApplyTaskToTodoistAction } from '../../../src/Domain/Actions/ApplyTaskToTodoistAction.js';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { ToDoData } from '../../../src/Domain/DataTransferObjects/ToDoData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import { taskRecord } from '../../helpers/records.js';

// Fakes at the ports: the vault records the anchor writes, the task manager
// holds the project's tasks and records every mutation, and the sync state
// holds the per-note Todoist bookkeeping. The writer's field gates are what's
// under test; the fakes' real mutation makes idempotency observable.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  writes: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.notes.set(path, content);
  }
  async createNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(): Promise<string[]> {
    return [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return [];
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
  }
  async moveTask(
    id: string,
    to: { sectionId?: string; parentId?: string },
  ): Promise<void> {
    this.moveTaskCalls.push({ id, to });
  }
  async setTaskCompleted(id: string, completed: boolean): Promise<void> {
    this.completeCalls.push({ id, completed });
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
  async fetchSections(): Promise<TodoistSectionData[]> {
    return [];
  }
  async createSection(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateSection(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
    return this.tasks;
  }
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async deleteTask(): Promise<never> {
    throw new Error('not used in this test');
  }
}

class FakeSyncState implements SyncStatePort {
  todoistStates = new Map<string, TaskData>();
  todoistSets: Array<{ notePath: string; state: TaskData }> = [];

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
  async getIdentity(): Promise<null> {
    return null;
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
    return null;
  }
  async setTodoistProjectState(): Promise<void> {}
  async getTodoistState(notePath: string): Promise<TaskData | null> {
    return this.todoistStates.get(notePath) ?? null;
  }
  async setTodoistState(notePath: string, state: TaskData): Promise<void> {
    this.todoistSets.push({ notePath, state });
    this.todoistStates.set(notePath, state);
  }
  async removeTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<TaskData[]> {
    return [...this.todoistStates.values()];
  }
}

const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const noteContent = '---\nstatus: Building\n---\n';

function twin(overrides: Partial<TodoistTaskData> = {}): TodoistTaskData {
  return {
    id: 'T9',
    projectId: 'P1',
    sectionId: 'S1',
    parentId: null,
    content: 'Fix the bug',
    labels: ['task'],
    isCompleted: false,
    url: 'https://app.todoist.com/app/task/T9',
    ...overrides,
  };
}

function task(overrides: Partial<TaskData> = {}): TaskData {
  return {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: '',
    todoistId: '',
    notePath,
    title: 'Fix the bug',
    body: '',
    status: 'Building',
    completed: false,
    parent: null,
    labels: ['task'],
    updatedAt: '',
    ...overrides,
  };
}

function todo(overrides: Partial<ToDoData> = {}): ToDoData {
  return {
    todoistId: '',
    notePath: 'Projecten/Acme Widgets/todos/step-one.md',
    projectName: 'Acme Widgets',
    taskLink: '',
    parentTodoLink: null,
    title: 'Step one',
    status: 'open',
    ...overrides,
  };
}

function setup() {
  const taskManager = new FakeTaskManager();
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const action = new ApplyTaskToTodoistAction(taskManager, vault, syncState);
  return { action, taskManager, vault, syncState };
}

const base = {
  projectId: 'P1',
  sectionId: 'S1',
  parentId: null,
  labels: ['task'],
  description: 'https://github.com/acme/widgets/issues/42',
  notePath,
  noteContent,
  syncedAt: '2026-09-18T12:00:00Z',
};

describe('ApplyTaskToTodoistAction', () => {
  describe('tasks', () => {
    it('creates a twin and stamps the anchor and snapshot when none exists', async () => {
      // Given — a tracked issue with no twin record
      const h = setup();

      // When — the winning task is rendered
      const id = await h.action.executeTask({
        task: task(),
        current: null,
        ...base,
      });

      // Then — a task is created, the anchor stamped, the snapshot recorded
      expect(h.taskManager.createTaskCalls).toHaveLength(1);
      expect(h.taskManager.ensureLabelCalls).toEqual(['task']);
      expect(h.vault.writes[0]!.content).toContain('todoist: T1');
      expect(h.syncState.todoistSets[0]!.state).toMatchObject({
        todoistId: 'T1',
        title: 'Fix the bug',
        status: 'Building',
        parent: null,
        completed: false,
      });
      expect(id).toBe('T1');
    });

    it('completes a freshly created twin when the winning task is done', async () => {
      // Given — a completed winning task with no twin
      const h = setup();

      // When — the task is rendered
      await h.action.executeTask({
        task: task({ completed: true, status: 'Shipped' }),
        current: null,
        ...base,
        sectionId: 'S3',
      });

      // Then — the created twin is completed
      expect(h.taskManager.completeCalls).toEqual([
        { id: 'T1', completed: true },
      ]);
    });

    it('writes nothing when the twin already matches', async () => {
      // Given — a settled twin
      const h = setup();
      h.syncState.todoistStates.set(
        notePath,
        taskRecord({
          todoistId: 'T9',
          notePath,
          completed: false,
          title: 'Fix the bug',
          status: 'Building',
          parent: null,
        }),
      );

      // When — the task is rendered
      await h.action.executeTask({ task: task(), current: twin(), ...base });

      // Then — no mutation happens
      expect(h.taskManager.createTaskCalls).toEqual([]);
      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
      expect(h.taskManager.completeCalls).toEqual([]);
      expect(h.taskManager.ensureLabelCalls).toEqual([]);
    });

    it('updates content and labels only when they differ', async () => {
      // Given — a twin whose content and labels drifted
      const h = setup();
      h.syncState.todoistStates.set(
        notePath,
        taskRecord({
          todoistId: 'T9',
          notePath,
          completed: false,
        }),
      );

      // When — the winning task is rendered
      await h.action.executeTask({
        task: task({ title: 'Fix the widget' }),
        current: twin({ content: 'Old title', labels: [] }),
        ...base,
      });

      // Then — only content and labels are written
      expect(h.taskManager.updateTaskCalls).toEqual([
        { id: 'T9', content: 'Fix the widget', labels: ['task'] },
      ]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
    });

    it('moves the section only when the lane differs', async () => {
      // Given — a twin in a different section
      const h = setup();
      h.syncState.todoistStates.set(
        notePath,
        taskRecord({
          todoistId: 'T9',
          notePath,
          completed: false,
        }),
      );

      // When — the winning task sits in another lane
      await h.action.executeTask({
        task: task({ status: 'Shipped' }),
        current: twin({ sectionId: 'S2' }),
        ...base,
        sectionId: 'S3',
      });

      // Then — only the section move happens
      expect(h.taskManager.moveTaskCalls).toEqual([
        { id: 'T9', to: { sectionId: 'S3' } },
      ]);
    });

    it('moves the parent only when the parent differs', async () => {
      // Given — a subtask whose parent drifted
      const h = setup();
      h.syncState.todoistStates.set(
        notePath,
        taskRecord({
          todoistId: 'T9',
          notePath,
          completed: false,
        }),
      );

      // When — the winning task nests under another slice
      await h.action.executeTask({
        task: task(),
        current: twin({ parentId: 'T-old' }),
        ...base,
        sectionId: null,
        parentId: 'T-slice',
      });

      // Then — only the parent move happens
      expect(h.taskManager.moveTaskCalls).toEqual([
        { id: 'T9', to: { parentId: 'T-slice' } },
      ]);
    });

    it('completes the twin when the vault completed the task', async () => {
      // Given — an active twin the vault marked done
      const h = setup();
      h.syncState.todoistStates.set(
        notePath,
        taskRecord({
          todoistId: 'T9',
          notePath,
          completed: false,
        }),
      );

      // When — the winning task is completed
      await h.action.executeTask({
        task: task({ completed: true, status: 'Shipped' }),
        current: twin(),
        ...base,
        sectionId: 'S3',
      });

      // Then — the twin is completed
      expect(h.taskManager.completeCalls).toEqual([
        { id: 'T9', completed: true },
      ]);
    });

    it('reopens an absent twin when the vault reopened the task', async () => {
      // Given — a stored twin absent from the active set (completed) the vault
      // reopened
      const h = setup();
      h.syncState.todoistStates.set(
        notePath,
        taskRecord({
          todoistId: 'T9',
          notePath,
          completed: true,
        }),
      );

      // When — the winning task is open
      await h.action.executeTask({ task: task(), current: null, ...base });

      // Then — the twin is reopened
      expect(h.taskManager.completeCalls).toEqual([
        { id: 'T9', completed: false },
      ]);
    });
  });

  describe('to-dos', () => {
    it('creates a to-do under its parent and stamps it', async () => {
      // Given — a to-do with no twin
      const h = setup();

      // When — the winning to-do is rendered
      const id = await h.action.executeToDo({
        todo: todo(),
        current: null,
        projectId: 'P1',
        parentId: 'T9',
        notePath: 'Projecten/Acme Widgets/todos/step-one.md',
        noteContent: '---\nstatus: open\n---\n',
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — a `todo`-labelled subtask is created and anchored
      expect(h.taskManager.createTaskCalls[0]).toMatchObject({
        projectId: 'P1',
        parentId: 'T9',
        content: 'Step one',
        labels: ['todo'],
      });
      expect(h.taskManager.ensureLabelCalls).toEqual(['todo']);
      expect(h.syncState.todoistSets[0]!.state.status).toBe('');
      expect(id).toBe('T1');
    });

    it('updates a to-do only when content or labels differ', async () => {
      // Given — a settled to-do twin
      const h = setup();
      h.syncState.todoistStates.set(
        'Projecten/Acme Widgets/todos/step-one.md',
        taskRecord({
          todoistId: 'T9',
          notePath: 'Projecten/Acme Widgets/todos/step-one.md',
          completed: false,
        }),
      );

      // When — the to-do is rendered with the same shape
      await h.action.executeToDo({
        todo: todo(),
        current: twin({
          id: 'T9',
          content: 'Step one',
          labels: ['todo'],
          parentId: 'T9p',
        }),
        projectId: 'P1',
        parentId: 'T9p',
        notePath: 'Projecten/Acme Widgets/todos/step-one.md',
        noteContent: '',
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — no write happens
      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
    });

    it('completes a to-do only when the vault-side completion moved', async () => {
      // Given — an active twin the vault completed
      const h = setup();
      h.syncState.todoistStates.set(
        'Projecten/Acme Widgets/todos/step-one.md',
        taskRecord({
          todoistId: 'T9',
          notePath: 'Projecten/Acme Widgets/todos/step-one.md',
          completed: false,
        }),
      );

      // When — the to-do is rendered completed
      await h.action.executeToDo({
        todo: todo({ status: 'completed' }),
        current: twin({
          id: 'T9',
          content: 'Step one',
          labels: ['todo'],
          parentId: 'T9p',
        }),
        projectId: 'P1',
        parentId: 'T9p',
        notePath: 'Projecten/Acme Widgets/todos/step-one.md',
        noteContent: '',
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — the twin is completed
      expect(h.taskManager.completeCalls).toEqual([
        { id: 'T9', completed: true },
      ]);
    });
  });
});
