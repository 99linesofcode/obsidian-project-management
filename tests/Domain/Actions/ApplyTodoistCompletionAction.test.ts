import { describe, expect, it } from 'vitest';
import { ApplyTodoistCompletionAction } from '../../../src/Domain/Actions/ApplyTodoistCompletionAction.js';
import { ApplyTaskToVaultAction } from '../../../src/Domain/Actions/ApplyTaskToVaultAction.js';
import { CompleteTaskCascadeAction } from '../../../src/Domain/Actions/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import { entityRecord, taskData, todoistTask } from '../../helpers/records.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

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
  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }
  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = this.notes.get(oldPath);
    if (content !== undefined) {
      this.notes.delete(oldPath);
      this.notes.set(newPath, content);
    }
  }
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
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
  failCompleted = false;

  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
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
  async fetchSections(): Promise<TodoistSectionData[]> {
    return [];
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

const projectName = 'Acme Widgets';
const projectId = 'P1';
const cursor = '2026-09-24T11:00:00Z';
const syncedAt = '2026-09-24T12:00:00Z';
const doneLane = 'Shipped';
const defaultLane = 'Unshaped';

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

const taskPath = 'Projecten/Acme Widgets/taken/fix-the-widget.md';
const todoPath = 'Projecten/Acme Widgets/todos/step-one.md';

function taskNote(status: string): string {
  return TaskNoteMapper.map(
    { type: 'task', title: 'fix the widget', body: '', createdAt: null },
    { projectName, syncedAt, statusName: status },
  ).content;
}

function todoNote(completedAt: string | null): string {
  return ToDoNoteMapper.map(
    { title: 'Step one', projectName, taskLink: 'fix-the-widget' },
    completedAt === null
      ? { syncedAt, statusName: 'open' }
      : { syncedAt, statusName: 'completed', completedAt },
  ).content;
}

// The registry record for a mirrored note, at the given handle and base.
function seedRecord(
  syncState: FakeSyncState,
  id: string,
  notePath: string,
  handle: string,
  base: TaskData,
): void {
  syncState.seed(entityRecord({ id, notePath }), {
    todoist: { handle, base },
  });
}

function setup() {
  const vault = new FakeVault();
  const taskManager = new FakeTaskManager();
  const syncState = new FakeSyncState();
  syncState.identities.set(projectName, identity);
  syncState.todoistProjects.set(projectName, {
    sections: { Unshaped: 'S1' },
    lastCompletedPoll: cursor,
  });
  const applyToVault = new ApplyTaskToVaultAction(
    vault,
    syncState,
    new CreateTaskNoteAction(vault, syncState, ''),
    '',
    new CompleteTaskCascadeAction(vault, doneLane),
  );
  const action = new ApplyTodoistCompletionAction(
    taskManager,
    vault,
    syncState,
    applyToVault,
    doneLane,
  );
  return { action, vault, taskManager, syncState };
}

const input = { projectName, projectId, syncedAt };

describe('ApplyTodoistCompletionAction', () => {
  it('completes a to-do note when Todoist completed the twin and stamps the base', async () => {
    // Given — an open to-do whose twin appears in the completed-since window
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(todoPath, todoNote(null));
    seedRecord(
      syncState,
      'uuid-todo',
      todoPath,
      'T2',
      taskData({ id: 'uuid-todo', notePath: todoPath, status: 'open' }),
    );
    taskManager.completed = [
      todoistTask({ id: 'T2', content: 'Step one', isCompleted: true, completedAt: cursor }),
    ];

    // When — the completion is applied
    await action.execute(input);

    // Then — the note is completed with a full ISO datetime stamp and the base
    // now says completed
    expect(vault.notes.get(todoPath)).toContain('status: completed');
    expect(vault.notes.get(todoPath)).toContain(`completed: ${syncedAt}`);
    const base = syncState.baseOf('uuid-todo', 'todoist');
    expect(base?.completedAt).not.toBeNull();
    expect(base?.status).toBe('completed');
  });

  it('completes a TASK twin: the note takes the done lane and the base is stamped', async () => {
    // Given — an open task note whose twin was completed in Todoist
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(taskPath, taskNote('Building'));
    seedRecord(
      syncState,
      'uuid-task',
      taskPath,
      'T9',
      taskData({ id: 'uuid-task', notePath: taskPath, status: 'Building' }),
    );
    taskManager.completed = [
      todoistTask({ id: 'T9', content: 'Fix the widget', isCompleted: true, completedAt: cursor }),
    ];

    // When — the completion pass runs
    await action.execute(input);

    // Then — the note is done and the todoist base is stamped (the ownership
    // fix: a task twin is no longer left to the task-side reconciliation)
    expect(vault.notes.get(taskPath)).toContain(`status: ${doneLane}`);
    const base = syncState.baseOf('uuid-task', 'todoist');
    expect(base?.status).toBe(doneLane);
    expect(base?.completedAt).toBe(cursor);
  });

  it('regression: a task twin completed remotely makes an open vault/GitHub task done', async () => {
    // Given — the old bug shape: the task is open in the vault and on GitHub,
    // but the Todoist twin was completed
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(taskPath, taskNote(defaultLane));
    seedRecord(
      syncState,
      'uuid-task',
      taskPath,
      'T9',
      taskData({ id: 'uuid-task', notePath: taskPath, status: defaultLane }),
    );
    taskManager.completed = [
      todoistTask({ id: 'T9', isCompleted: true, completedAt: cursor }),
    ];
    taskManager.active = [];

    // When — the completion pass runs
    await action.execute(input);

    // Then — the vault is done, not stuck open
    expect(vault.notes.get(taskPath)).toContain(`status: ${doneLane}`);
  });

  it('reopens a task twin active again while the base says completed (asymmetric)', async () => {
    // Given — a completed task note whose twin is active again, with a
    // completed to-do that must stay completed
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(taskPath, taskNote(doneLane));
    vault.notes.set(todoPath, todoNote('2026-09-24T10:00:00Z'));
    seedRecord(
      syncState,
      'uuid-task',
      taskPath,
      'T9',
      taskData({ id: 'uuid-task', notePath: taskPath, status: doneLane, completedAt: cursor }),
    );
    taskManager.active = [todoistTask({ id: 'T9', isCompleted: false })];

    // When — the reopen pass runs
    await action.execute(input);

    // Then — the task is pulled back to the default lane
    expect(vault.notes.get(taskPath)).toContain(`status: ${defaultLane}`);
    // And the to-do is NOT reopened (the cascade's asymmetry)
    expect(vault.notes.get(todoPath)).toContain('status: completed');
    // And the base now says open
    const base = syncState.baseOf('uuid-task', 'todoist');
    expect(base?.completedAt).toBeNull();
  });

  it('clears the completion stamp when Todoist reopened a to-do twin', async () => {
    // Given — a completed to-do whose twin is active again
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(todoPath, todoNote('2026-09-24T10:00:00Z'));
    seedRecord(
      syncState,
      'uuid-todo',
      todoPath,
      'T2',
      taskData({ id: 'uuid-todo', notePath: todoPath, status: 'completed', completedAt: cursor }),
    );
    taskManager.active = [todoistTask({ id: 'T2', isCompleted: false })];

    // When — the reopen is applied
    await action.execute(input);

    // Then — the note is reopened and the stamp cleared
    expect(vault.notes.get(todoPath)).toContain('status: open');
    expect(vault.notes.get(todoPath)).not.toContain('2026-09-24T10:00:00Z');
  });

  it('does not re-apply our own completion as a remote change (echo guard)', async () => {
    // Given — a completed twin whose base already says completed, still showing
    // in the window (the echo of our own close)
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(todoPath, todoNote('2026-09-24T10:00:00Z'));
    seedRecord(
      syncState,
      'uuid-todo',
      todoPath,
      'T2',
      taskData({ id: 'uuid-todo', notePath: todoPath, status: 'completed', completedAt: cursor }),
    );
    taskManager.completed = [
      todoistTask({ id: 'T2', isCompleted: true, completedAt: cursor }),
    ];
    const before = await syncState.get('uuid-todo');

    // When — the window is processed
    await action.execute(input);

    // Then — no vault write and no base churn
    expect(vault.writes).toEqual([]);
    expect(await syncState.get('uuid-todo')).toBe(before);
  });

  it('does not advance the cursor when the completed-since fetch fails', async () => {
    // Given — a failing completed-since fetch
    const { action, taskManager, syncState } = setup();
    taskManager.failCompleted = true;

    // When — the action runs
    const result = action.execute(input);

    // Then — it rejects and the cursor is left untouched, so the window retries
    await expect(result).rejects.toThrow('completed-since fetch failed');
    expect(syncState.todoistProjects.get(projectName)?.lastCompletedPoll).toBe(
      cursor,
    );
  });

  it('advances the cursor and preserves the section map after a pass', async () => {
    // Given — a project with a stored section map
    const { action, syncState } = setup();

    // When — the action runs with nothing to apply
    await action.execute(input);

    // Then — the cursor moved to the tick and the sections survived
    expect(syncState.todoistProjects.get(projectName)).toEqual({
      sections: { Unshaped: 'S1' },
      lastCompletedPoll: syncedAt,
    });
  });
});
