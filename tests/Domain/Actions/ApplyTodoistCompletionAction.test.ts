import { describe, expect, it } from 'vitest';
import { ApplyTodoistCompletionAction } from '../../../src/Domain/Actions/ApplyTodoistCompletionAction.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

// Fakes at the ports: the vault holds the to-do notes and records writes, the
// task manager serves the completed-since and active sets (and can be made to
// fail), and the sync state holds the per-item bookkeeping and the per-project
// cursor. The action's completion pull and its cursor discipline are what's
// under test.
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
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeTaskManager implements TaskManagerPort {
  completed: TodoistTaskData[] = [];
  active: TodoistTaskData[] = [];
  completedCalls: Array<{ projectId: string; since: string }> = [];
  failCompleted = false;

  async fetchCompletedTasks(
    projectId: string,
    since: string,
  ): Promise<TodoistTaskData[]> {
    this.completedCalls.push({ projectId, since });
    if (this.failCompleted) {
      throw new Error('completed-since fetch failed');
    }
    return this.completed;
  }
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
  async fetchSections(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createSection(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateSection(): Promise<never> {
    throw new Error('not used in this test');
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
  async deleteTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async ensureLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
}

class FakeSyncState implements SyncStatePort {
  todoistItemStates = new Map<string, TaskData>();
  todoistItemSets: Array<{ notePath: string; state: TaskData }> = [];
  projectState: TodoistProjectStateData | null = null;
  projectSets: Array<{ projectName: string; state: TodoistProjectStateData }> =
    [];

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
  async getTodoistProjectState(): Promise<TodoistProjectStateData | null> {
    return this.projectState;
  }
  async setTodoistProjectState(
    projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    this.projectSets.push({ projectName, state });
    this.projectState = state;
  }

  async get(): Promise<TaskData | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<null> {
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
}

const projectName = 'Acme Widgets';
const projectId = 'P1';
const cursor = '2026-09-24T11:00:00Z';
const syncedAt = '2026-09-24T12:00:00Z';
const todoPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';

function todoNote(status: string, completedAt: string | null): string {
  return [
    '---',
    'categories: ["[[Todos.base|Todos]]"]',
    'affiliation: ["[[Acme Widgets]]", "[[41-chore-1]]"]',
    `status: ${status}`,
    completedAt === null ? 'completed:' : `completed: ${completedAt}`,
    '---',
    '',
  ].join('\n');
}

function task(
  id: string,
  parentId: string | null,
  content: string,
  isCompleted: boolean,
): TodoistTaskData {
  return {
    id,
    projectId,
    sectionId: null,
    parentId,
    content,
    labels: ['todo'],
    isCompleted,
    url: `https://app.todoist.com/app/task/${id}`,
  };
}

function state(
  todoistId: string,
  notePath: string,
  completed: boolean,
): TaskData {
  return taskRecord({ todoistId, notePath, completed });
}

function setup() {
  const vault = new FakeVault();
  const taskManager = new FakeTaskManager();
  const syncState = new FakeSyncState();
  syncState.projectState = {
    sections: { Unshaped: 'S1' },
    lastCompletedPoll: cursor,
  };
  const action = new ApplyTodoistCompletionAction(
    taskManager,
    vault,
    syncState,
  );
  return { action, vault, taskManager, syncState };
}

describe('ApplyTodoistCompletionAction', () => {
  it('stamps the vault note when Todoist completed the twin', async () => {
    // Given — an open to-do whose twin appears in the completed-since window
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(todoPath, todoNote('open', null));
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, false));
    taskManager.completed = [task('T2', 'T1', 'Fix the widget', true)];

    // When — the completion is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the window resumed from the stored cursor
    expect(taskManager.completedCalls).toEqual([{ projectId, since: cursor }]);
    // And the note is completed with a full ISO datetime stamp
    const content = vault.notes.get(todoPath)!;
    expect(content).toContain('status: completed');
    expect(content).toContain(`completed: ${syncedAt}`);
    // And the snapshot now says completed
    expect(syncState.todoistItemSets).toEqual([
      {
        notePath: todoPath,
        state: taskRecord({
          url: '',
          remoteId: 0,
          todoistId: 'T2',
          notePath: todoPath,
          completed: true,
          title: 'Fix the widget',
          parent: 'T1',
          labels: ['todo'],
        }),
      },
    ]);
  });

  it('clears the completion stamp when Todoist reopened the twin', async () => {
    // Given — a completed to-do whose twin is active again and whose snapshot
    // said completed
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(todoPath, todoNote('completed', '2026-09-24T10:00:00Z'));
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, true));
    taskManager.active = [task('T2', 'T1', 'Fix the widget', false)];

    // When — the reopen is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the note is reopened and the stamp cleared
    const content = vault.notes.get(todoPath)!;
    expect(content).toContain('status: open');
    expect(content).toMatch(/completed:[ \t]*$/m);
    expect(content).not.toContain('2026-09-24T10:00:00Z');
    // And the snapshot now says open
    expect(syncState.todoistItemSets[0]!.state.completed).toBe(false);
  });

  it('does not re-apply our own completion as a remote change', async () => {
    // Given — a completed to-do whose snapshot already says completed, and
    // whose completion still shows in the window (the echo of our own close)
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(todoPath, todoNote('completed', '2026-09-24T10:00:00Z'));
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, true));
    taskManager.completed = [task('T2', 'T1', 'Fix the widget', true)];

    // When — the window is processed
    await action.execute({ projectName, projectId, syncedAt });

    // Then — no vault write and no snapshot churn
    expect(vault.writes).toEqual([]);
    expect(syncState.todoistItemSets).toEqual([]);
  });

  it('restamps without rewriting a note already completed in the vault', async () => {
    // Given — a completed to-do whose snapshot said open, and whose twin
    // completed remotely
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(todoPath, todoNote('completed', '2026-09-24T10:30:00Z'));
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, false));
    taskManager.completed = [task('T2', 'T1', 'Fix the widget', true)];

    // When — the completion is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the vault note is untouched (its own stamp is kept) and only the
    // snapshot moves to completed
    expect(vault.writes).toEqual([]);
    expect(syncState.todoistItemSets[0]!.state.completed).toBe(true);
  });

  it('ignores a completed task twin that is not a to-do', async () => {
    // Given — a completed task twin with no to-do state record
    const { action, vault, taskManager, syncState } = setup();
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, false));
    vault.notes.set(todoPath, todoNote('open', null));
    taskManager.completed = [task('T1', null, 'Chore 1', true)];

    // When — the window is processed
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the task twin is left to t5
    expect(vault.writes).toEqual([]);
    expect(syncState.todoistItemSets).toEqual([]);
  });

  it('does not advance the cursor when the completed-since fetch fails', async () => {
    // Given — a failing completed-since fetch
    const { action, taskManager, syncState } = setup();
    taskManager.failCompleted = true;

    // When — the action runs
    const result = action.execute({ projectName, projectId, syncedAt });

    // Then — it rejects and the cursor is left untouched, so the window retries
    await expect(result).rejects.toThrow('completed-since fetch failed');
    expect(syncState.projectSets).toEqual([]);
  });

  it('advances the cursor and preserves the section map after a pass', async () => {
    // Given — a project with a stored section map
    const { action, syncState } = setup();

    // When — the action runs with nothing to apply
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the cursor moved to the tick and the sections survived
    expect(syncState.projectSets).toEqual([
      {
        projectName,
        state: {
          sections: { Unshaped: 'S1' },
          lastCompletedPoll: syncedAt,
        },
      },
    ]);
  });

  it('starts the window at the tick when no cursor is stored', async () => {
    // Given — a project with no stored state yet
    const { action, taskManager, syncState } = setup();
    syncState.projectState = null;

    // When — the action runs
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the completed-since window starts at the tick
    expect(taskManager.completedCalls).toEqual([
      { projectId, since: syncedAt },
    ]);
  });

  it('leaves a to-do whose note is gone untouched', async () => {
    // Given — a to-do state whose note no longer exists
    const { action, vault, taskManager, syncState } = setup();
    syncState.todoistItemStates.set(todoPath, state('T2', todoPath, true));
    taskManager.active = [task('T2', 'T1', 'Fix the widget', false)];

    // When — the reopen is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — no write is attempted for the missing note
    expect(vault.writes).toEqual([]);
  });
});
