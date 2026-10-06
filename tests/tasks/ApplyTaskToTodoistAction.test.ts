import { describe, expect, it } from 'vitest';
import { ApplyTaskToTodoistAction } from '../../src/tasks/ApplyTaskToTodoistAction.js';
import { ToDoData } from '../../src/shared/ToDoData.js';
import { hash } from '../../src/shared/hash.js';
import type { CreateTodoistTaskData } from '../../src/todoist/CreateTodoistTaskData.js';
import type { ProjectNoteData } from '../../src/projects/ProjectNoteData.js';
import type { TaskData } from '../../src/shared/TaskData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { TaskManagerPort } from '../../src/todoist/TaskManagerPort.js';
import type { VaultPort } from '../../src/vault/VaultPort.js';
import { entityRecord, taskData, todoistTask } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: the vault records the anchor writes, the task manager
// holds the project's tasks and records every mutation, and the registry holds
// the per-note entity records. The writer's field gates and its base advance
// are what's under test.
class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
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
    to: { sectionId?: string; parentId?: string | null };
  }> = [];
  completeCalls: Array<{ id: string; completed: boolean }> = [];
  ensureLabelCalls: string[] = [];
  private nextTaskId = 1;

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
    to: { sectionId?: string; parentId?: string | null },
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

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const noteContent = '---\nid: uuid-42\nstatus: Building\n---\n';
const projectName = 'Acme Widgets';

function task(overrides: Partial<TaskData> = {}): TaskData {
  return taskData({
    id: 'uuid-42',
    notePath,
    title: 'Fix the bug',
    body: '',
    status: 'Building',
    type: 'task',
    ...overrides,
  });
}

function todo(overrides: Partial<ToDoData> = {}): ToDoData {
  return new ToDoData(
    overrides.id ?? 'todo-uuid',
    overrides.notePath ?? 'Projecten/Acme Widgets/todos/step-one.md',
    overrides.mirrors ?? {},
    overrides.title ?? 'Step one',
    overrides.status ?? 'open',
    overrides.completedAt ?? null,
    overrides.parentTodo ?? null,
    overrides.task ?? 'uuid-42',
    overrides.createdAt ?? null,
    overrides.updatedAt ?? null,
  );
}

function setup() {
  const taskManager = new FakeTaskManager();
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const action = new ApplyTaskToTodoistAction(taskManager, syncState);
  return { action, taskManager, vault, syncState };
}

// The tracked entity record for the task note, at the given todoist handle and
// base. A null handle means the note is not yet mirrored to Todoist.
function seedRecord(
  syncState: FakeSyncState,
  handle: string | null,
  base: TaskData | null = null,
): void {
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: { handle: url },
    ...(handle === null ? {} : { todoist: { handle, base } }),
  });
}

const base = {
  projectId: 'P1',
  sectionId: 'S1',
  parentId: null,
  labels: ['task'],
  notePath,
  syncedAt: '2026-09-18T12:00:00Z',
};

describe('ApplyTaskToTodoistAction', () => {
  describe('tasks', () => {
    it('creates a twin and records the todoist mirror when none exists', async () => {
      // Given — a tracked issue with no twin
      const h = setup();
      seedRecord(h.syncState, null);
      h.vault.notes.set(notePath, noteContent);

      // When — the winning task is rendered
      const id = await h.action.executeTask({
        task: task(),
        current: null,
        ...base,
      });

      // Then — a task is created and the mirror recorded; the dead `todoist`
      // note anchor is NOT stamped (the registry is the identity source)
      expect(h.taskManager.createTaskCalls).toHaveLength(1);
      expect(h.taskManager.ensureLabelCalls).toEqual(['task']);
      expect(h.vault.writes).toEqual([]);
      expect(h.syncState.handleOf('uuid-42', 'todoist')).toBe('T1');
      expect(h.syncState.baseOf('uuid-42', 'todoist')?.title).toBe('Fix the bug');
      expect(h.syncState.baseOf('uuid-42', 'todoist')?.status).toBe('Building');
      // And the github mirror survived the advance
      expect(h.syncState.handleOf('uuid-42', 'github')).toBe(url);
      expect(id).toBe('T1');
    });

    it('writes nothing when the twin already matches', async () => {
      // Given — a settled twin
      const h = setup();
      seedRecord(h.syncState, 'T9', taskData({ status: 'Building' }));

      // When — the task is rendered
      await h.action.executeTask({
        task: task(),
        current: todoistTask({
          id: 'T9',
          sectionId: 'S1',
          content: 'Fix the bug',
          labels: ['task'],
        }),
        ...base,
      });

      // Then — no mutation happens
      expect(h.taskManager.createTaskCalls).toEqual([]);
      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
      expect(h.taskManager.completeCalls).toEqual([]);
      expect(h.taskManager.ensureLabelCalls).toEqual([]);
    });

    it('repairs an old-format base digest without a remote write when the twin matches', async () => {
      // Given — a settled twin whose base still carries a pre-widening digest
      const h = setup();
      seedRecord(
        h.syncState,
        'T9',
        taskData({ status: 'Building', body: 'a1b2c3d4' }),
      );

      // When — the identical task is rendered
      await h.action.executeTask({
        task: task(),
        current: todoistTask({
          id: 'T9',
          sectionId: 'S1',
          content: 'Fix the bug',
          labels: ['task'],
        }),
        ...base,
      });

      // Then — no remote mutation happens, but the base advances to the new
      // 16-char digest
      expect(h.taskManager.createTaskCalls).toEqual([]);
      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
      expect(h.taskManager.completeCalls).toEqual([]);
      const storedBase = h.syncState.baseOf('uuid-42', 'todoist');
      expect(storedBase?.body).toBe(hash(''));
      expect(storedBase?.body).toHaveLength(16);
    });

    it('leaves the base untouched on an equal-state pass with no remote write', async () => {
      // Given — a settled twin whose stored base already carries the desired
      // diff view (settled by one pass)
      const h = setup();
      seedRecord(h.syncState, 'T9', null);
      const current = todoistTask({
        id: 'T9',
        sectionId: 'S1',
        content: 'Fix the bug',
        labels: ['task'],
      });
      await h.action.executeTask({ task: task(), current, ...base });
      h.taskManager.createTaskCalls = [];
      h.taskManager.updateTaskCalls = [];
      h.taskManager.moveTaskCalls = [];
      h.taskManager.completeCalls = [];
      h.taskManager.ensureLabelCalls = [];
      const before = h.syncState.baseOf('uuid-42', 'todoist');

      // When — the identical task is rendered again
      await h.action.executeTask({ task: task(), current, ...base });

      // Then — no remote mutation and the base is not rewritten: the same
      // no-op-skip contract ApplyTaskToGithubAction enforces.
      expect(h.taskManager.createTaskCalls).toEqual([]);
      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
      expect(h.taskManager.completeCalls).toEqual([]);
      expect(h.taskManager.ensureLabelCalls).toEqual([]);
      expect(h.syncState.baseOf('uuid-42', 'todoist')).toBe(before);
    });

    it('updates content and labels only when they differ', async () => {
      // Given — a twin whose content and labels drifted
      const h = setup();
      seedRecord(h.syncState, 'T9');

      // When — the winning task is rendered
      await h.action.executeTask({
        task: task({ title: 'Fix the widget' }),
        current: todoistTask({
          id: 'T9',
          sectionId: 'S1',
          content: 'Old title',
          labels: [],
        }),
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
      seedRecord(h.syncState, 'T9');

      // When — the winning task sits in another lane
      await h.action.executeTask({
        task: task({ status: 'Shipped' }),
        current: todoistTask({ id: 'T9', sectionId: 'S2' }),
        ...base,
        sectionId: 'S3',
      });

      // Then — only the section move happens
      expect(h.taskManager.moveTaskCalls).toEqual([
        { id: 'T9', to: { sectionId: 'S3' } },
      ]);
    });

    it('moves an existing twin when its parent changes', async () => {
      // Given — a settled top-level twin that the vault now nests under a
      // parent twin (the sub-issue repair path)
      const h = setup();
      seedRecord(h.syncState, 'T9', taskData({ status: 'Building' }));

      // When — the task is rendered with a parent
      await h.action.executeTask({
        task: task(),
        current: todoistTask({ id: 'T9', sectionId: 'S1' }),
        ...base,
        sectionId: null,
        parentId: 'T-parent',
      });

      // Then — the twin is moved under the parent
      expect(h.taskManager.moveTaskCalls).toEqual([
        { id: 'T9', to: { parentId: 'T-parent' } },
      ]);
    });

    it('completes the twin and advances the base when the vault completed the task', async () => {
      // Given — an active twin the vault marked done
      const h = setup();
      seedRecord(h.syncState, 'T9', taskData({ status: 'Building' }));

      // When — the winning task is completed
      await h.action.executeTask({
        task: task({ status: 'Shipped', completedAt: '2026-09-18T12:00:00Z' }),
        current: todoistTask({ id: 'T9' }),
        ...base,
        sectionId: 'S3',
      });

      // Then — the twin is completed and the base carries the completion stamp
      expect(h.taskManager.completeCalls).toEqual([
        { id: 'T9', completed: true },
      ]);
      const storedBase = h.syncState.baseOf('uuid-42', 'todoist');
      expect(storedBase?.completedAt).toBe('2026-09-18T12:00:00Z');
      expect(storedBase?.status).toBe('Shipped');
    });

    it('reopens an absent twin and moves it out of the done section', async () => {
      // Given — a stored twin absent from the active set (completed in the done
      // section) that the vault reopened into a non-done lane
      const h = setup();
      seedRecord(
        h.syncState,
        'T9',
        taskData({ status: 'Shipped', completedAt: '2026-09-18T12:00:00Z' }),
      );

      // When — the winning task is open in the default lane
      await h.action.executeTask({ task: task(), current: null, ...base });

      // Then — the twin is reopened AND moved back to the lane's section
      expect(h.taskManager.completeCalls).toEqual([
        { id: 'T9', completed: false },
      ]);
      expect(h.taskManager.moveTaskCalls).toEqual([
        { id: 'T9', to: { sectionId: 'S1' } },
      ]);
      expect(h.syncState.baseOf('uuid-42', 'todoist')?.completedAt).toBeNull();
    });

    it('re-points a stale record’s todoist handle to the real record (the handle index)', async () => {
      // Given — a stale record elsewhere claiming the twin handle the real
      // record is about to mint
      const h = setup();
      seedRecord(h.syncState, null);
      h.vault.notes.set(notePath, noteContent);
      h.syncState.seed(
        entityRecord({
          id: 'stale-uuid',
          notePath: 'Projecten/Acme Widgets/taken/stale.md',
        }),
        { todoist: { handle: 'T1' } },
      );

      // When — the real record creates and claims the twin
      await h.action.executeTask({ task: task(), current: null, ...base });

      // Then — the handle index resolves to the real record; the stale record
      // loses the handle but survives (a collision re-points, never destroys)
      const owner = await h.syncState.findByMirror('todoist', 'T1');
      expect(owner?.id).toBe('uuid-42');
      expect(await h.syncState.get('stale-uuid')).not.toBeNull();
    });

    it('leaves an already-completed absent twin settled (no re-complete, no base rewrite)', async () => {
      // Given — a stored twin absent from the active set whose base already
      // carries the completion stamp
      const h = setup();
      seedRecord(
        h.syncState,
        'T9',
        taskData({ status: 'Shipped', completedAt: '2026-09-18T12:00:00Z' }),
      );
      const before = await h.syncState.get('uuid-42');

      // When — the winning task is still completed
      await h.action.executeTask({
        task: task({ status: 'Shipped', completedAt: '2026-09-18T12:00:00Z' }),
        current: null,
        ...base,
        sectionId: 'S3',
      });

      // Then — no completion write and no base rewrite (the dt-17 settle)
      expect(h.taskManager.completeCalls).toEqual([]);
      expect(await h.syncState.get('uuid-42')).toBe(before);
    });
  });

  describe('to-dos', () => {
    const todoPath = 'Projecten/Acme Widgets/todos/step-one.md';

    it('creates a to-do under its parent and records its base with the parent uuid', async () => {
      // Given — a to-do with no twin and a parent task record
      const h = setup();
      h.syncState.seed(entityRecord({ id: 'task-uuid', notePath }), {
        todoist: { handle: 'T9' },
      });
      h.syncState.seed(
        entityRecord({ id: 'todo-uuid', notePath: todoPath }),
      );
      h.vault.notes.set(
        todoPath,
        '---\nid: todo-uuid\nstatus: open\n---\n',
      );

      // When — the winning to-do is rendered
      const id = await h.action.executeToDo({
        todo: todo(),
        current: null,
        projectId: 'P1',
        parentId: 'T9',
        projectName,
        notePath: todoPath,
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — a `todo`-labelled subtask is created and the base records the
      // parent's uuid
      expect(h.taskManager.createTaskCalls[0]).toMatchObject({
        projectId: 'P1',
        parentId: 'T9',
        content: 'Step one',
        labels: ['todo'],
      });
      expect(h.taskManager.ensureLabelCalls).toEqual(['todo']);
      expect(h.syncState.handleOf('todo-uuid', 'todoist')).toBe('T1');
      expect(h.syncState.baseOf('todo-uuid', 'todoist')?.parent).toBe(
        'task-uuid',
      );
      expect(h.syncState.baseOf('todo-uuid', 'todoist')?.status).toBe('open');
      expect(id).toBe('T1');
    });

    it('updates a to-do only when content or labels differ', async () => {
      // Given — a settled to-do twin
      const h = setup();
      h.syncState.seed(entityRecord({ id: 'todo-uuid', notePath: todoPath }), {
        todoist: { handle: 'T9', base: taskData({ status: 'open' }) },
      });

      // When — the to-do is rendered with the same shape
      await h.action.executeToDo({
        todo: todo(),
        current: todoistTask({
          id: 'T9',
          content: 'Step one',
          labels: ['todo'],
          parentId: 'T9p',
        }),
        projectId: 'P1',
        parentId: 'T9p',
        projectName,
        notePath: todoPath,
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — no write happens
      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
    });

    it('completes a to-do only when the vault-side completion moved', async () => {
      // Given — an active twin the vault completed
      const h = setup();
      h.syncState.seed(entityRecord({ id: 'todo-uuid', notePath: todoPath }), {
        todoist: { handle: 'T9', base: taskData({ status: 'open' }) },
      });

      // When — the to-do is rendered completed
      await h.action.executeToDo({
        todo: todo({ status: 'completed' }),
        current: todoistTask({
          id: 'T9',
          content: 'Step one',
          labels: ['todo'],
          parentId: 'T9p',
        }),
        projectId: 'P1',
        parentId: 'T9p',
        projectName,
        notePath: todoPath,
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — the twin is completed and the base records it
      expect(h.taskManager.completeCalls).toEqual([
        { id: 'T9', completed: true },
      ]);
      expect(h.syncState.baseOf('todo-uuid', 'todoist')?.status).toBe(
        'completed',
      );
    });

    it('refuses a note outside the project to-do folder', async () => {
      // Given — a to-do whose notePath is a bare stem, not the todos/ note
      const h = setup();

      // When — the winning to-do is rendered
      const id = await h.action.executeToDo({
        todo: todo({ notePath: 'note-edit-step-one' }),
        current: null,
        projectId: 'P1',
        parentId: 'T9',
        projectName,
        notePath: 'note-edit-step-one',
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — nothing is created, labelled, stamped or written
      expect(id).toBe('');
      expect(h.taskManager.createTaskCalls).toEqual([]);
      expect(h.taskManager.ensureLabelCalls).toEqual([]);
      expect(h.vault.writes).toEqual([]);
    });

    it('creates a top-level to-do in its lane section when it has no parent twin', async () => {
      // Given — a to-do whose parent is a slice (no twin to nest under, dt-23)
      const h = setup();
      h.syncState.seed(
        entityRecord({ id: 'todo-uuid', notePath: todoPath }),
      );

      // When — the winning to-do is rendered top-level
      const id = await h.action.executeToDo({
        todo: todo(),
        current: null,
        projectId: 'P1',
        parentId: null,
        sectionId: 'S2',
        projectName,
        notePath: todoPath,
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — the `todo`-labelled task is created in the lane section, with no
      // parent, and its base records no parent uuid
      expect(h.taskManager.createTaskCalls[0]).toMatchObject({
        projectId: 'P1',
        sectionId: 'S2',
        content: 'Step one',
        labels: ['todo'],
      });
      expect(h.taskManager.createTaskCalls[0]!.parentId).toBeUndefined();
      expect(h.syncState.baseOf('todo-uuid', 'todoist')?.parent).toBeNull();
      expect(id).toBe('T1');
    });

    it('unparents a nested to-do into its lane section when it moves to top-level', async () => {
      // Given — a to-do twin nested under a slice twin it can no longer follow
      const h = setup();
      h.syncState.seed(entityRecord({ id: 'todo-uuid', notePath: todoPath }), {
        todoist: { handle: 'T9', base: taskData({ status: 'open' }) },
      });

      // When — the to-do is rendered top-level in its lane
      await h.action.executeToDo({
        todo: todo(),
        current: todoistTask({
          id: 'T9',
          content: 'Step one',
          labels: ['todo'],
          parentId: 'SLICE',
          sectionId: 'S1',
        }),
        projectId: 'P1',
        parentId: null,
        sectionId: 'S2',
        projectName,
        notePath: todoPath,
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — one move unparents it and lands it in the lane section
      expect(h.taskManager.moveTaskCalls).toEqual([
        { id: 'T9', to: { sectionId: 'S2', parentId: null } },
      ]);
    });

    it('moves a top-level to-do to its lane section only', async () => {
      // Given — a top-level to-do twin in the wrong section
      const h = setup();
      h.syncState.seed(entityRecord({ id: 'todo-uuid', notePath: todoPath }), {
        todoist: { handle: 'T9', base: taskData({ status: 'open' }) },
      });

      // When — the to-do is rendered in another lane
      await h.action.executeToDo({
        todo: todo(),
        current: todoistTask({
          id: 'T9',
          content: 'Step one',
          labels: ['todo'],
          parentId: null,
          sectionId: 'S1',
        }),
        projectId: 'P1',
        parentId: null,
        sectionId: 'S2',
        projectName,
        notePath: todoPath,
        syncedAt: '2026-09-18T12:00:00Z',
      });

      // Then — only a section move happens (no spurious unparent)
      expect(h.taskManager.moveTaskCalls).toEqual([
        { id: 'T9', to: { sectionId: 'S2' } },
      ]);
    });
  });
});
