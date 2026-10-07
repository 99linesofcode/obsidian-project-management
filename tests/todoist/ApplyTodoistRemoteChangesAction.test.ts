import { describe, expect, it } from 'vitest';
import { ApplyTodoistRemoteChangesAction } from '../../src/todoist/ApplyTodoistRemoteChangesAction.js';
import type { ApplyTodoistRemoteChangesInput } from '../../src/todoist/ApplyTodoistRemoteChangesAction.js';
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
  renames: Array<{ oldPath: string; newPath: string }> = [];

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
    this.renames.push({ oldPath, newPath });
    const content = this.notes.get(oldPath);
    if (content !== undefined) {
      this.notes.delete(oldPath);
      this.notes.set(newPath, content);
    }
  }
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

class FakePropagateStatus {
  calls: Array<{
    url: string;
    statusName: string;
    notePath: string;
    projectName: string;
  }> = [];
  async execute(input: {
    url: string;
    statusName: string;
    notePath: string;
    projectName: string;
  }): Promise<void> {
    this.calls.push(input);
  }
}

class FakeRelocateTaskStatus {
  calls: Array<{ oldPath: string; newPath: string }> = [];
  async execute(input: { oldPath: string; newPath: string }): Promise<void> {
    this.calls.push(input);
  }
}

class FakeRelinkRenamedTodo {
  calls: Array<{ oldPath: string; newPath: string; syncedAt: string }> = [];
  async execute(input: {
    oldPath: string;
    newPath: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
  }
}

const projectName = 'Acme Widgets';
const syncedAt = '2026-09-24T12:00:00Z';
const doneOptionName = 'Shipped';
const choreUrl = 'https://github.com/acme/widgets/issues/42';

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

const sections = { Unshaped: 'S1', Building: 'S2', Shipped: 'S3' };

function taskNote(
  status: string,
  affiliation: string[],
  url: string | null = choreUrl,
): string {
  return [
    '---',
    ...(url === null ? [] : [`url: ${url}`]),
    `status: ${status}`,
    `affiliation: [${affiliation.map((link) => `"${link}"`).join(', ')}]`,
    'todoist: T1',
    '---',
    'Body.',
  ].join('\n');
}

function seedRecord(
  syncState: FakeSyncState,
  id: string,
  notePath: string,
  handle: string,
  base: Partial<TaskData> = {},
  githubUrl: string | null = choreUrl,
): void {
  syncState.seed(entityRecord({ id, notePath }), {
    ...(githubUrl === null ? {} : { github: { handle: githubUrl } }),
    todoist: {
      handle,
      base: taskData({ id, notePath, title: 'Chore 1', ...base }),
    },
  });
}

function setup() {
  const vault = new FakeVault();
  const taskManager = new FakeTaskManager();
  const syncState = new FakeSyncState();
  syncState.identities.set(projectName, identity);
  syncState.todoistProjects.set(projectName, {
    sections,
    lastCompletedPoll: '2026-09-24T11:00:00Z',
  });
  const propagateStatus = new FakePropagateStatus();
  const relocateTaskStatus = new FakeRelocateTaskStatus();
  const relinkRenamedTodo = new FakeRelinkRenamedTodo();
  const action = new ApplyTodoistRemoteChangesAction(
    vault,
    syncState,
    propagateStatus as never,
    relocateTaskStatus as never,
    relinkRenamedTodo as never,
    doneOptionName,
  );
  const run = (
    overrides: Partial<ApplyTodoistRemoteChangesInput> = {},
  ): Promise<void> =>
    action.execute({
      projectName,
      connectionSlug: 'todoist',
      githubConnectionSlug: 'github',
      syncedAt,
      snapshot: {
        active: taskManager.active,
        completed: taskManager.completed,
      },
      ...overrides,
    });
  return {
    action,
    run,
    vault,
    taskManager,
    syncState,
    propagateStatus,
    relocateTaskStatus,
    relinkRenamedTodo,
  };
}

describe('SYNC-2 — a remote change flows in and fans out', () => {
  it('renames a to-do note when Todoist renamed the twin, relinking the checklist', async () => {
    const { run, vault, taskManager, syncState, relinkRenamedTodo } = setup();
    const todoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
    vault.notes.set(
      todoPath,
      taskNote('open', ['[[Acme Widgets]]', '[[42-chore-1]]'], null),
    );
    seedRecord(syncState, 'uuid-todo', todoPath, 'T2', {
      title: 'fix the bug',
      parent: 'uuid-task',
    });
    taskManager.active = [
      todoistTask({ id: 'T2', content: 'Fix the widget', parentId: 'T1' }),
    ];

    await run();

    const newPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';
    expect(vault.renames).toEqual([{ oldPath: todoPath, newPath }]);
    expect(relinkRenamedTodo.calls).toEqual([
      { oldPath: todoPath, newPath, syncedAt },
    ]);
  });

  it('renames a task note keeping its issue-id prefix', async () => {
    const { run, vault, taskManager, syncState, relocateTaskStatus } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    seedRecord(syncState, 'uuid-task', taskPath, 'T1', { status: 'Unshaped' });
    taskManager.active = [
      todoistTask({ id: 'T1', content: 'Chore 1 renamed' }),
    ];

    await run();

    const newPath = 'Projecten/Acme Widgets/taken/42-chore-1-renamed.md';
    expect(vault.renames).toEqual([{ oldPath: taskPath, newPath }]);
    expect(relocateTaskStatus.calls).toEqual([{ oldPath: taskPath, newPath }]);
  });

  it('moves the note and the board card when Todoist dragged a top-level task to a lane', async () => {
    const { run, vault, taskManager, syncState, propagateStatus } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    seedRecord(syncState, 'uuid-task', taskPath, 'T1', { status: 'Unshaped' });
    taskManager.active = [
      todoistTask({ id: 'T1', content: 'Chore 1', sectionId: 'S2' }),
    ];

    await run();

    expect(vault.writes[0]!.content).toContain('status: Building');
    expect(propagateStatus.calls).toEqual([
      {
        url: choreUrl,
        statusName: 'Building',
        notePath: taskPath,
        projectName,
        connectionSlug: 'github',
      },
    ]);
    expect(syncState.baseOf('uuid-task', 'todoist')?.status).toBe('Building');
  });

  it('gains the slice affiliation when a task is dragged under a slice twin', async () => {
    const { run, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    const slicePath = 'Projecten/Acme Widgets/taken/40-slice-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    seedRecord(syncState, 'uuid-task', taskPath, 'T9', { status: '' });
    seedRecord(syncState, 'uuid-slice', slicePath, 'T1', {}, null);
    taskManager.active = [
      todoistTask({ id: 'T9', content: 'Chore 1', parentId: 'T1' }),
    ];

    await run();

    expect(vault.writes[0]!.content).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[40-slice-1]]"]',
    );
    expect(syncState.baseOf('uuid-task', 'todoist')?.parent).toBe('uuid-slice');
  });

  it('drops the slice affiliation when a task is dragged back to top level', async () => {
    const { run, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    const slicePath = 'Projecten/Acme Widgets/taken/40-slice-1.md';
    vault.notes.set(
      taskPath,
      taskNote('Unshaped', ['[[Acme Widgets]]', '[[40-slice-1]]']),
    );
    seedRecord(syncState, 'uuid-task', taskPath, 'T9', {
      status: '',
      parent: 'uuid-slice',
    });
    seedRecord(syncState, 'uuid-slice', slicePath, 'T1', {}, null);
    taskManager.active = [todoistTask({ id: 'T9', content: 'Chore 1' })];

    await run();

    expect(vault.writes[0]!.content).toContain(
      'affiliation: ["[[_Acme Widgets]]"]',
    );
    expect(syncState.baseOf('uuid-task', 'todoist')?.parent).toBeNull();
  });

  it('lets the vault win when both sides changed', async () => {
    const { run, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Building', ['[[Acme Widgets]]']));
    seedRecord(syncState, 'uuid-task', taskPath, 'T1', { status: 'Unshaped' });
    taskManager.active = [
      todoistTask({ id: 'T1', content: 'Chore 1 renamed', sectionId: 'S1' }),
    ];

    await run();

    expect(vault.renames).toEqual([]);
    expect(vault.writes).toEqual([]);
    expect(syncState.baseOf('uuid-task', 'todoist')?.title).toBe(
      'Chore 1 renamed',
    );
  });

  it('ignores a section change on a subtask (it inherits its parent)', async () => {
    const { run, vault, taskManager, syncState } = setup();
    const childPath = 'Projecten/Acme Widgets/taken/41-chore-1.md';
    const slicePath = 'Projecten/Acme Widgets/taken/40-slice-1.md';
    vault.notes.set(
      childPath,
      taskNote('Unshaped', ['[[Acme Widgets]]', '[[40-slice-1]]']),
    );
    seedRecord(syncState, 'uuid-slice', slicePath, 'SLICE', {}, null);
    seedRecord(syncState, 'uuid-child', childPath, 'T1', {
      parent: 'uuid-slice',
    });
    taskManager.active = [
      todoistTask({
        id: 'T1',
        content: 'Chore 1',
        parentId: 'SLICE',
        sectionId: 'S2',
      }),
    ];

    await run();

    expect(vault.writes).toEqual([]);
  });

  it('is idempotent: a settled item is not touched on a second pass', async () => {
    const { run, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    seedRecord(syncState, 'uuid-task', taskPath, 'T1', { status: 'Unshaped' });
    taskManager.active = [
      todoistTask({ id: 'T1', content: 'Chore 1', sectionId: 'S2' }),
    ];
    await run();
    vault.writes = [];

    await run();

    expect(vault.writes).toEqual([]);
  });

  it('skips a completed twin: completion is the completion action’s', async () => {
    const { run, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    seedRecord(syncState, 'uuid-task', taskPath, 'T1', { status: 'Unshaped' });
    taskManager.active = [
      todoistTask({ id: 'T1', isCompleted: true, completedAt: syncedAt }),
    ];

    await run();

    expect(vault.writes).toEqual([]);
  });

  it('evicts the record of a twin deleted in Todoist so the projection re-creates it', async () => {
    const { run, vault, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    seedRecord(syncState, 'uuid-task', taskPath, 'T1');

    await run();

    expect(syncState.removed).toEqual(['uuid-task']);
    expect(await syncState.findByMirror('todoist', 'T1')).toBeNull();
    expect(await vault.getNoteByPath(taskPath)).not.toBeNull();
    expect(vault.writes).toEqual([]);
  });

  it('keeps a completed record whose twin aged out of the completed window', async () => {
    const { run, vault, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Shipped', ['[[Acme Widgets]]']));
    seedRecord(syncState, 'uuid-task', taskPath, 'T1', {
      status: 'Shipped',
      completedAt: syncedAt,
    });

    await run();

    expect(syncState.removed).toEqual([]);
    expect(vault.writes).toEqual([]);
  });

  it('leaves a missing note to the deletion action', async () => {
    const { run, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    seedRecord(syncState, 'uuid-task', taskPath, 'T1');

    await run();

    expect(syncState.removed).toEqual([]);
    expect(await syncState.get('uuid-task')).not.toBeNull();
  });
});
