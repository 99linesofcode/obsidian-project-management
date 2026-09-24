import { describe, expect, it } from 'vitest';
import { PropagateTodoistDeletionsAction } from '../../../src/Domain/Actions/PropagateTodoistDeletionsAction.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistStateData } from '../../../src/Domain/DataTransferObjects/TodoistStateData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the vault holds the mirrored notes (a missing path is a
// vault deletion), the task manager records every twin deletion (and can be
// made to fail), and the sync state holds the per-item bookkeeping and records
// evictions. The action's decisions — which twins go, which records are evicted
// with them — are what's under test.
class FakeVault implements VaultPort {
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

class FakeSyncState implements SyncStatePort {
  todoistItemStates = new Map<string, TodoistStateData>();
  removals: string[] = [];

  async getTodoistState(notePath: string): Promise<TodoistStateData | null> {
    return this.todoistItemStates.get(notePath) ?? null;
  }
  async setTodoistState(
    notePath: string,
    state: TodoistStateData,
  ): Promise<void> {
    this.todoistItemStates.set(notePath, state);
  }
  async removeTodoistState(notePath: string): Promise<void> {
    this.todoistItemStates.delete(notePath);
    this.removals.push(notePath);
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

const taskPath = 'Projecten/Acme Widgets/taken/41-task.md';
const todoPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';
const nestedTodoPath = 'Projecten/Acme Widgets/todos/and-then-test-it.md';
const otherPath = 'Projecten/Other Project/taken/9-other.md';

function state(
  notePath: string,
  todoistId: string,
  lastSyncedParent: string | null = null,
): TodoistStateData {
  return {
    todoistId,
    notePath,
    lastSyncedHash: 'stale',
    lastSyncedCompleted: false,
    lastSyncedParent,
  };
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

describe('PropagateTodoistDeletionsAction', () => {
  it('deletes a deleted task note’s twin and evicts its whole subtree’s records', async () => {
    // Given — a task note gone, with a to-do and a nested to-do still present
    const { action, vault, taskManager, syncState } = setup();
    syncState.todoistItemStates.set(taskPath, state(taskPath, 'T1'));
    syncState.todoistItemStates.set(todoPath, state(todoPath, 'T2', 'T1'));
    syncState.todoistItemStates.set(
      nestedTodoPath,
      state(nestedTodoPath, 'T3', 'T2'),
    );
    vault.notes.set(todoPath, '---\nstatus: open\n---\n');
    vault.notes.set(nestedTodoPath, '---\nstatus: open\n---\n');

    // When — deletions are propagated
    await action.execute({ projectName });

    // Then — only the root twin is deleted (the API cascades the subtree)
    expect(taskManager.deleteCalls).toEqual(['T1']);
    // And every record the cascade orphaned is evicted, descendants included
    expect(syncState.removals.sort()).toEqual(
      [taskPath, todoPath, nestedTodoPath].sort(),
    );
    expect(syncState.todoistItemStates.size).toBe(0);
  });

  it('deletes a deleted to-do note’s subtask twin and evicts its record', async () => {
    // Given — a to-do note gone, its parent task note still present
    const { action, vault, taskManager, syncState } = setup();
    syncState.todoistItemStates.set(taskPath, state(taskPath, 'TASK'));
    syncState.todoistItemStates.set(todoPath, state(todoPath, 'T7', 'TASK'));
    vault.notes.set(taskPath, '---\ntodoist: TASK\n---\n');

    // When — deletions are propagated
    await action.execute({ projectName });

    // Then — only the to-do twin is deleted and only its record evicted
    expect(taskManager.deleteCalls).toEqual(['T7']);
    expect(syncState.removals).toEqual([todoPath]);
    expect(syncState.todoistItemStates.has(taskPath)).toBe(true);
  });

  it('leaves a twin alone when its note survives (a Todoist-side deletion self-heals)', async () => {
    // Given — a note that still exists, so nothing is a vault deletion
    const { action, vault, taskManager, syncState } = setup();
    syncState.todoistItemStates.set(taskPath, state(taskPath, 'T1'));
    vault.notes.set(taskPath, '---\ntodoist: T1\n---\n');

    // When — deletions are propagated
    await action.execute({ projectName });

    // Then — no twin is deleted and no record is evicted; the projection owns
    // re-creating a twin that is missing while its note survives
    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removals).toEqual([]);
  });

  it('never deletes a twin because it completed (deletion keys on the note)', async () => {
    // Given — a completed item: absent from the active set, but its note exists
    const { action, vault, taskManager, syncState } = setup();
    syncState.todoistItemStates.set(todoPath, state(todoPath, 'T7', 'TASK'));
    vault.notes.set(todoPath, '---\nstatus: completed\n---\n');

    // When — deletions are propagated
    await action.execute({ projectName });

    // Then — the twin is untouched: completion is not a deletion signal
    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removals).toEqual([]);
  });

  it('is idempotent: a second pass over an already-evicted deletion does nothing', async () => {
    // Given — a deletion propagated once
    const { action, vault, taskManager, syncState } = setup();
    syncState.todoistItemStates.set(todoPath, state(todoPath, 'T7', 'TASK'));
    vault.notes.set(taskPath, '---\ntodoist: TASK\n---\n');
    await action.execute({ projectName });
    taskManager.deleteCalls = [];

    // When — the same deletion is propagated again
    await action.execute({ projectName });

    // Then — no twin is deleted again and no record is re-evicted
    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removals).toEqual([todoPath]);
  });

  it('deletes the twin before evicting its record (the echo guard)', async () => {
    // Given — a deleted note whose twin deletion fails
    const { action, taskManager, syncState } = setup();
    syncState.todoistItemStates.set(taskPath, state(taskPath, 'T1'));
    taskManager.failDelete = true;

    // When — deletions are propagated
    await expect(action.execute({ projectName })).rejects.toThrow(
      'delete failed',
    );

    // Then — the record survives, so the anchor is never orphaned: a capture
    // pass cannot see an unanchored twin and re-create it, and the next tick
    // retries the delete
    expect(syncState.removals).toEqual([]);
    expect(syncState.todoistItemStates.has(taskPath)).toBe(true);
  });

  it('leaves another project’s deleted-note records alone', async () => {
    // Given — a deleted note in a different project
    const { action, taskManager, syncState } = setup();
    syncState.todoistItemStates.set(otherPath, state(otherPath, 'OTHER'));

    // When — this project's deletions are propagated
    await action.execute({ projectName });

    // Then — the other project's twin is untouched
    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removals).toEqual([]);
  });

  it('does nothing when the project has no mirrored records', async () => {
    // Given — an empty sync state
    const { action, taskManager, syncState } = setup();

    // When — deletions are propagated
    await action.execute({ projectName });

    // Then — nothing is read or written
    expect(taskManager.deleteCalls).toEqual([]);
    expect(syncState.removals).toEqual([]);
  });
});
