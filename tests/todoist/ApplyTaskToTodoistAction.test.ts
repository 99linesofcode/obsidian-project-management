import { describe, expect, it } from 'vitest';
import { ApplyTaskToTodoistAction } from '../../src/todoist/ApplyTaskToTodoistAction.js';
import { ToDoData } from '../../src/shared/ToDoData.js';
import { hash } from '../../src/shared/hash.js';
import type { CreateTodoistTaskData } from '../../src/todoist/CreateTodoistTaskData.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { TaskData } from '../../src/shared/TaskData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { TaskManagerPort } from '../../src/shared/TaskManagerPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
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

describe('SYNC-1 — a vault task flows outward to Todoist', () => {
  describe('MAT-1 — a task projects to its Todoist twin', () => {
    it('creates a twin and records the todoist mirror when none exists', async () => {
      const h = setup();
      seedRecord(h.syncState, null);
      h.vault.notes.set(notePath, noteContent);

      const id = await h.action.executeTask({
        task: task(),
        current: null,
        ...base,
      });

      expect(h.taskManager.createTaskCalls).toHaveLength(1);
      expect(h.taskManager.ensureLabelCalls).toEqual(['task']);
      expect(h.vault.writes).toEqual([]);
      expect(h.syncState.handleOf('uuid-42', 'todoist')).toBe('T1');
      expect(h.syncState.baseOf('uuid-42', 'todoist')?.title).toBe('Fix the bug');
      expect(h.syncState.baseOf('uuid-42', 'todoist')?.status).toBe('Building');
      expect(h.syncState.handleOf('uuid-42', 'github')).toBe(url);
      expect(id).toBe('T1');
    });

    it('writes nothing when the twin already matches', async () => {
      const h = setup();
      seedRecord(h.syncState, 'T9', taskData({ status: 'Building' }));

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

      expect(h.taskManager.createTaskCalls).toEqual([]);
      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
      expect(h.taskManager.completeCalls).toEqual([]);
      expect(h.taskManager.ensureLabelCalls).toEqual([]);
    });

    it('repairs an old-format base digest without a remote write when the twin matches', async () => {
      const h = setup();
      seedRecord(
        h.syncState,
        'T9',
        taskData({ status: 'Building', body: 'a1b2c3d4' }),
      );

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

      expect(h.taskManager.createTaskCalls).toEqual([]);
      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
      expect(h.taskManager.completeCalls).toEqual([]);
      const storedBase = h.syncState.baseOf('uuid-42', 'todoist');
      expect(storedBase?.body).toBe(hash(''));
      expect(storedBase?.body).toHaveLength(16);
    });

    it('leaves the base untouched on an equal-state pass with no remote write', async () => {
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

      await h.action.executeTask({ task: task(), current, ...base });

      expect(h.taskManager.createTaskCalls).toEqual([]);
      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
      expect(h.taskManager.completeCalls).toEqual([]);
      expect(h.taskManager.ensureLabelCalls).toEqual([]);
      expect(h.syncState.baseOf('uuid-42', 'todoist')).toBe(before);
    });

    it('updates content and labels only when they differ', async () => {
      const h = setup();
      seedRecord(h.syncState, 'T9');

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

      expect(h.taskManager.updateTaskCalls).toEqual([
        { id: 'T9', content: 'Fix the widget', labels: ['task'] },
      ]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
    });

    it('moves the twin only for the placement that actually differs', async () => {
      const cases: Array<{
        name: string;
        seeded: TaskData | null;
        task: TaskData;
        current: TodoistTaskData;
        sectionId: string | null;
        parentId?: string | null;
        expected: Array<{
          id: string;
          to: { sectionId?: string; parentId?: string | null };
        }>;
      }> = [
        {
          name: 'lane differs',
          seeded: taskData({ status: 'Building' }),
          task: task({ status: 'Shipped' }),
          current: todoistTask({ id: 'T9', sectionId: 'S2' }),
          sectionId: 'S3',
          expected: [{ id: 'T9', to: { sectionId: 'S3' } }],
        },
        {
          name: 'parent changes',
          seeded: taskData({ status: 'Building' }),
          task: task(),
          current: todoistTask({ id: 'T9', sectionId: 'S1' }),
          sectionId: null,
          parentId: 'T-parent',
          expected: [{ id: 'T9', to: { parentId: 'T-parent' } }],
        },
      ];
      for (const { name, seeded, task: t, current, sectionId, parentId, expected } of cases) {
        const h = setup();
        seedRecord(h.syncState, 'T9', seeded);

        await h.action.executeTask({
          task: t,
          current,
          ...base,
          sectionId,
          ...(parentId === undefined ? {} : { parentId }),
        });

        expect(h.taskManager.moveTaskCalls, name).toEqual(expected);
      }
    });

    it('completes or reopens the twin to match the vault, and advances the base', async () => {
      const done = task({
        status: 'Shipped',
        completedAt: '2026-09-18T12:00:00Z',
      });
      const h = setup();
      seedRecord(h.syncState, 'T9', taskData({ status: 'Building' }));
      await h.action.executeTask({
        task: done,
        current: todoistTask({ id: 'T9' }),
        ...base,
        sectionId: 'S3',
      });
      expect(h.taskManager.completeCalls).toEqual([
        { id: 'T9', completed: true },
      ]);
      expect(h.syncState.baseOf('uuid-42', 'todoist')?.completedAt).toBe(
        '2026-09-18T12:00:00Z',
      );
      expect(h.syncState.baseOf('uuid-42', 'todoist')?.status).toBe('Shipped');

      const reopened = setup();
      seedRecord(
        reopened.syncState,
        'T9',
        taskData({ status: 'Shipped', completedAt: '2026-09-18T12:00:00Z' }),
      );
      await reopened.action.executeTask({
        task: task(),
        current: null,
        ...base,
      });
      expect(reopened.taskManager.completeCalls).toEqual([
        { id: 'T9', completed: false },
      ]);
      expect(reopened.taskManager.moveTaskCalls).toEqual([
        { id: 'T9', to: { sectionId: 'S1' } },
      ]);
      expect(
        reopened.syncState.baseOf('uuid-42', 'todoist')?.completedAt,
      ).toBeNull();
    });

    it('re-points a stale record’s todoist handle to the real record (the handle index)', async () => {
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

      await h.action.executeTask({ task: task(), current: null, ...base });

      const owner = await h.syncState.findByMirror('todoist', 'T1');
      expect(owner?.id).toBe('uuid-42');
      expect(await h.syncState.get('stale-uuid')).not.toBeNull();
    });

    it('leaves an already-completed absent twin settled (no re-complete, no base rewrite)', async () => {
      const h = setup();
      seedRecord(
        h.syncState,
        'T9',
        taskData({ status: 'Shipped', completedAt: '2026-09-18T12:00:00Z' }),
      );
      const before = await h.syncState.get('uuid-42');

      await h.action.executeTask({
        task: task({ status: 'Shipped', completedAt: '2026-09-18T12:00:00Z' }),
        current: null,
        ...base,
        sectionId: 'S3',
      });

      expect(h.taskManager.completeCalls).toEqual([]);
      expect(await h.syncState.get('uuid-42')).toBe(before);
    });

    it('never moves the GitHub base when the Todoist mirror is written', async () => {
      const h = setup();
      const githubBase = taskData({ id: 'uuid-42', notePath });
      h.syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
        github: { handle: url, base: githubBase },
      });
      h.vault.notes.set(notePath, noteContent);

      await h.action.executeTask({ task: task(), current: null, ...base });

      expect(h.syncState.handleOf('uuid-42', 'todoist')).toBe('T1');
      expect(h.syncState.baseOf('uuid-42', 'github')).toBe(githubBase);
      expect(h.syncState.handleOf('uuid-42', 'github')).toBe(url);
    });
  });

  describe('TODO-1 — a to-do projects under its actionable parent', () => {
    const todoPath = 'Projecten/Acme Widgets/todos/step-one.md';

    it('creates a to-do under its parent and records its base with the parent uuid', async () => {
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

      const id = await h.action.executeToDo({
        todo: todo(),
        current: null,
        projectId: 'P1',
        parentId: 'T9',
        projectName,
        notePath: todoPath,
        syncedAt: '2026-09-18T12:00:00Z',
      });

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
      const h = setup();
      h.syncState.seed(entityRecord({ id: 'todo-uuid', notePath: todoPath }), {
        todoist: { handle: 'T9', base: taskData({ status: 'open' }) },
      });

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

      expect(h.taskManager.updateTaskCalls).toEqual([]);
      expect(h.taskManager.moveTaskCalls).toEqual([]);
    });

    it('completes a to-do only when the vault-side completion moved', async () => {
      const h = setup();
      h.syncState.seed(entityRecord({ id: 'todo-uuid', notePath: todoPath }), {
        todoist: { handle: 'T9', base: taskData({ status: 'open' }) },
      });

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

      expect(h.taskManager.completeCalls).toEqual([
        { id: 'T9', completed: true },
      ]);
      expect(h.syncState.baseOf('todo-uuid', 'todoist')?.status).toBe(
        'completed',
      );
    });

    it('refuses a note outside the project to-do folder', async () => {
      const h = setup();

      const id = await h.action.executeToDo({
        todo: todo({ notePath: 'note-edit-step-one' }),
        current: null,
        projectId: 'P1',
        parentId: 'T9',
        projectName,
        notePath: 'note-edit-step-one',
        syncedAt: '2026-09-18T12:00:00Z',
      });

      expect(id).toBe('');
      expect(h.taskManager.createTaskCalls).toEqual([]);
      expect(h.taskManager.ensureLabelCalls).toEqual([]);
      expect(h.vault.writes).toEqual([]);
    });

    it('creates a top-level to-do in its lane section when it has no parent twin', async () => {
      const h = setup();
      h.syncState.seed(
        entityRecord({ id: 'todo-uuid', notePath: todoPath }),
      );

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

    it('moves a top-level to-do to its lane, unparenting first when nested', async () => {
      const cases: Array<{
        name: string;
        currentParentId: string | null;
        expected: { sectionId?: string; parentId?: string | null };
      }> = [
        {
          name: 'nested under a slice',
          currentParentId: 'SLICE',
          expected: { sectionId: 'S2', parentId: null },
        },
        {
          name: 'already top-level',
          currentParentId: null,
          expected: { sectionId: 'S2' },
        },
      ];
      for (const { name, currentParentId, expected } of cases) {
        const h = setup();
        h.syncState.seed(
          entityRecord({ id: 'todo-uuid', notePath: todoPath }),
          {
            todoist: { handle: 'T9', base: taskData({ status: 'open' }) },
          },
        );

        await h.action.executeToDo({
          todo: todo(),
          current: todoistTask({
            id: 'T9',
            content: 'Step one',
            labels: ['todo'],
            parentId: currentParentId,
            sectionId: 'S1',
          }),
          projectId: 'P1',
          parentId: null,
          sectionId: 'S2',
          projectName,
          notePath: todoPath,
          syncedAt: '2026-09-18T12:00:00Z',
        });

        expect(h.taskManager.moveTaskCalls, name).toEqual([
          { id: 'T9', to: expected },
        ]);
      }
    });
  });
});
