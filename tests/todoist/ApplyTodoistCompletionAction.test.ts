import { describe, expect, it } from 'vitest';
import { ApplyTodoistCompletionAction } from '../../src/todoist/ApplyTodoistCompletionAction.js';
import type { ApplyTodoistCompletionInput } from '../../src/todoist/ApplyTodoistCompletionAction.js';
import { ApplyTaskToVaultAction } from '../../src/tasks/ApplyTaskToVaultAction.js';
import { CompleteTaskCascadeAction } from '../../src/tasks/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../src/tasks/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../src/vault/TaskNoteMapper.js';
import { ToDoNoteMapper } from '../../src/vault/ToDoNoteMapper.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { TaskData } from '../../src/shared/TaskData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { TaskManagerPort } from '../../src/shared/TaskManagerPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import { entityRecord, taskData, todoistTask } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

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

  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
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
    vault,
    syncState,
    applyToVault,
    doneLane,
  );
  const run = (
    overrides: Partial<ApplyTodoistCompletionInput> = {},
  ): Promise<void> =>
    action.execute({
      projectName,
      syncedAt,
      snapshot: {
        active: taskManager.active,
        completed: taskManager.completed,
      },
      ...overrides,
    });
  return { action, run, vault, taskManager, syncState };
}

describe('COM-3 — a Todoist completion fans out like a vault one', () => {
  it('completes a to-do note when Todoist completed the twin and stamps the base', async () => {
    const { run, vault, taskManager, syncState } = setup();
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

    await run();

    expect(vault.notes.get(todoPath)).toContain('status: completed');
    expect(vault.notes.get(todoPath)).toContain(`completed: ${syncedAt}`);
    const base = syncState.baseOf('uuid-todo', 'todoist');
    expect(base?.completedAt).not.toBeNull();
    expect(base?.status).toBe('completed');
  });

  it('completes a TASK twin: the note takes the done lane and the base is stamped', async () => {
    const { run, vault, taskManager, syncState } = setup();
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

    await run();

    expect(vault.notes.get(taskPath)).toContain(`status: ${doneLane}`);
    const base = syncState.baseOf('uuid-task', 'todoist');
    expect(base?.status).toBe(doneLane);
    expect(base?.completedAt).toBe(cursor);
  });

  it('regression: a task twin completed remotely makes an open vault/GitHub task done', async () => {
    const { run, vault, taskManager, syncState } = setup();
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

    await run();

    expect(vault.notes.get(taskPath)).toContain(`status: ${doneLane}`);
  });

  it('reopens a task twin active again while the base says completed (asymmetric)', async () => {
    const { run, vault, taskManager, syncState } = setup();
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

    await run();

    expect(vault.notes.get(taskPath)).toContain(`status: ${defaultLane}`);
    expect(vault.notes.get(todoPath)).toContain('status: completed');
    const base = syncState.baseOf('uuid-task', 'todoist');
    expect(base?.completedAt).toBeNull();
  });

  it('clears the completion stamp when Todoist reopened a to-do twin', async () => {
    const { run, vault, taskManager, syncState } = setup();
    vault.notes.set(todoPath, todoNote('2026-09-24T10:00:00Z'));
    seedRecord(
      syncState,
      'uuid-todo',
      todoPath,
      'T2',
      taskData({ id: 'uuid-todo', notePath: todoPath, status: 'completed', completedAt: cursor }),
    );
    taskManager.active = [todoistTask({ id: 'T2', isCompleted: false })];

    await run();

    expect(vault.notes.get(todoPath)).toContain('status: open');
    expect(vault.notes.get(todoPath)).not.toContain('2026-09-24T10:00:00Z');
  });

  it('does not re-apply our own completion as a remote change (echo guard)', async () => {
    const { run, vault, taskManager, syncState } = setup();
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

    await run();

    expect(vault.writes).toEqual([]);
    expect(await syncState.get('uuid-todo')).toBe(before);
  });

  it('advances the cursor and preserves the section map after a pass', async () => {
    const { run, syncState } = setup();

    await run();

    expect(syncState.todoistProjects.get(projectName)).toEqual({
      sections: { Unshaped: 'S1' },
      lastCompletedPoll: syncedAt,
    });
  });
});
