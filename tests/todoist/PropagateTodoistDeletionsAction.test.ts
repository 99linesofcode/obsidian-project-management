import { describe, expect, it } from 'vitest';
import { PropagateTodoistDeletionsAction } from '../../src/todoist/PropagateTodoistDeletionsAction.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { TaskManagerPort } from '../../src/shared/TaskManagerPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: the vault holds the mirrored notes (a missing path is a
// vault deletion), the task manager records every twin deletion (and can be
// made to fail), and the registry holds the entity records and records
// evictions. The action's decisions — which twins go, which records are evicted
// with them — are what's under test.
class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Map<string, string>();

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
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
  deleteCalls: string[] = [];
  failDelete = false;

  async deleteTask(id: string): Promise<void> {
    this.deleteCalls.push(id);
    if (this.failDelete) {
      throw new Error('delete failed');
    }
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
  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async createTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async moveTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setTaskCompleted(): Promise<never> {
    throw new Error('not used in this test');
  }
  async ensureLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const projectName = 'Acme Widgets';
const taskPath = 'Projecten/Acme Widgets/taken/41-task.md';
const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
const sliceChildPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
const todoPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';
const nestedTodoPath = 'Projecten/Acme Widgets/todos/and-then-test-it.md';
const otherPath = 'Projecten/Other Project/taken/9-other.md';

// A record whose todoist base carries the given parent uuid.
function record(
  syncState: FakeSyncState,
  id: string,
  notePath: string,
  handle: string,
  parent: string | null,
): void {
  syncState.seed(entityRecord({ id, notePath }), {
    todoist: {
      handle,
      base: taskData({ id, notePath, parent, status: '' }),
    },
  });
}

function setup() {
  const vault = new FakeVault();
  const taskManager = new FakeTaskManager();
  const syncState = new FakeSyncState();
  const action = new PropagateTodoistDeletionsAction(
    taskManager,
    vault,
    syncState,
  );
  return { action, vault, taskManager, syncState };
}

describe('DEL-2 — a remote deletion never deletes the note of record', () => {
  it('deletes a deleted task note’s twin and evicts its whole subtree’s records', async () => {
    const { action, vault, taskManager, syncState } = setup();
    record(syncState, 'uuid-task', taskPath, 'T1', null);
    record(syncState, 'uuid-todo', todoPath, 'T2', 'uuid-task');
    record(syncState, 'uuid-nested', nestedTodoPath, 'T3', 'uuid-todo');
    vault.notes.set(todoPath, '---\nstatus: open\n---\n');
    vault.notes.set(nestedTodoPath, '---\nstatus: open\n---\n');

    await action.execute({ projectName, connectionSlug: 'todoist', githubConnectionSlug: 'github' });

    expect(taskManager.deleteCalls).toEqual(['T1']);
    expect(syncState.removed.sort()).toEqual(
      ['uuid-task', 'uuid-todo', 'uuid-nested'].sort(),
    );
    expect(await syncState.list()).toEqual([]);
  });

  it('deletes a deleted to-do note’s subtask twin and evicts its record', async () => {
    const { action, vault, taskManager, syncState } = setup();
    record(syncState, 'uuid-task', taskPath, 'TASK', null);
    record(syncState, 'uuid-todo', todoPath, 'T7', 'uuid-task');
    vault.notes.set(taskPath, '---\nstatus: open\n---\n');

    await action.execute({ projectName, connectionSlug: 'todoist', githubConnectionSlug: 'github' });

    expect(taskManager.deleteCalls).toEqual(['T7']);
    expect(syncState.removed).toEqual(['uuid-todo']);
    expect(await syncState.get('uuid-task')).not.toBeNull();
  });

  it('leaves a twin alone when its note survives (a Todoist-side deletion self-heals)', async () => {
    const { action, vault, taskManager, syncState } = setup();
    record(syncState, 'uuid-task', taskPath, 'T1', null);
    vault.notes.set(taskPath, '---\nstatus: open\n---\n');

    await action.execute({ projectName, connectionSlug: 'todoist', githubConnectionSlug: 'github' });

    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });

  it('leaves a slice twin alone while its note survives (retirement is policy, not propagation)', async () => {
    const { action, vault, taskManager, syncState } = setup();
    record(syncState, 'uuid-slice', slicePath, 'SLICE', null);
    record(syncState, 'uuid-child', sliceChildPath, 'CHILD', 'uuid-slice');
    vault.notes.set(
      slicePath,
      '---\ntype: slice\nstatus: Building\n---\n',
    );
    vault.notes.set(
      sliceChildPath,
      '---\ntype: task\nstatus: Building\n---\n',
    );

    await action.execute({ projectName, connectionSlug: 'todoist', githubConnectionSlug: 'github' });

    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });

  it('never deletes a twin because it completed (deletion keys on the note)', async () => {
    const { action, vault, taskManager, syncState } = setup();
    syncState.seed(entityRecord({ id: 'uuid-todo', notePath: todoPath }), {
      todoist: {
        handle: 'T7',
        base: taskData({
          id: 'uuid-todo',
          notePath: todoPath,
          parent: 'uuid-task',
        }),
      },
    });
    vault.notes.set(todoPath, '---\nstatus: completed\n---\n');

    await action.execute({ projectName, connectionSlug: 'todoist', githubConnectionSlug: 'github' });

    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });

  it('deletes the twin before evicting its record, and retries a failed delete next pass', async () => {
    const { action, taskManager, syncState } = setup();
    record(syncState, 'uuid-task', taskPath, 'T1', null);
    taskManager.failDelete = true;

    await expect(action.execute({ projectName, connectionSlug: 'todoist', githubConnectionSlug: 'github' })).rejects.toThrow(
      'delete failed',
    );

    expect(syncState.removed).toEqual([]);
    expect(await syncState.get('uuid-task')).not.toBeNull();
    expect(await syncState.findByMirror('todoist', 'T1')).not.toBeNull();

    taskManager.failDelete = false;
    await action.execute({ projectName, connectionSlug: 'todoist', githubConnectionSlug: 'github' });

    expect(taskManager.deleteCalls).toEqual(['T1', 'T1']);
    expect(syncState.removed).toEqual(['uuid-task']);
    expect(await syncState.get('uuid-task')).toBeNull();
  });

  it('leaves another project’s deleted-note records alone', async () => {
    const { action, taskManager, syncState } = setup();
    record(syncState, 'uuid-other', otherPath, 'OTHER', null);

    await action.execute({ projectName, connectionSlug: 'todoist', githubConnectionSlug: 'github' });

    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });

  it('does nothing when the project has no mirrored records', async () => {
    const { action, taskManager, syncState } = setup();

    await action.execute({ projectName, connectionSlug: 'todoist', githubConnectionSlug: 'github' });

    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });
});
