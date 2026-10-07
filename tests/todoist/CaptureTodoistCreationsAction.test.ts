import { describe, expect, it } from 'vitest';
import { CaptureTodoistCreationsAction } from '../../src/todoist/CaptureTodoistCreationsAction.js';
import type { CaptureTodoistCreationsInput } from '../../src/todoist/CaptureTodoistCreationsAction.js';
import { splitFrontmatter } from '../../src/vault/splitFrontmatter.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { TaskManagerPort } from '../../src/shared/TaskManagerPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import { entityRecord, todoistTask } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: the vault holds note content and records creations and
// writes; the task manager serves the fetched active/completed sets (and would
// throw if the action ever wrote back to Todoist); the registry holds the
// entity records and the lane map. The kind classification and the captured
// note shape are what's under test.
class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  writes: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(path: string, content: string): Promise<void> {
    this.created.push({ path, content });
    this.notes.set(path, content);
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.notes.set(path, content);
  }
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
    throw new Error('the creation action never writes to Todoist');
  }
  async updateProject(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async setProjectArchived(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async fetchSections(): Promise<TodoistSectionData[]> {
    return [];
  }
  async createSection(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async updateSection(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async createTask(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async updateTask(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async moveTask(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async setTaskCompleted(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async deleteTask(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
  async ensureLabel(): Promise<never> {
    throw new Error('the creation action never writes to Todoist');
  }
}

const projectName = 'Acme Widgets';
const syncedAt = '2026-09-24T12:00:00Z';
const doneOptionName = 'Shipped';

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

function taskNote(body: string, todoistId = 'TASK'): string {
  return [
    '---',
    'id: task-uuid',
    'status: Unshaped',
    'affiliation: ["[[Acme Widgets]]"]',
    `todoist: ${todoistId}`,
    '---',
    body,
  ].join('\n');
}

function anchored(
  syncState: FakeSyncState,
  id: string,
  notePath: string,
  handle: string,
): void {
  syncState.seed(entityRecord({ id, notePath }), {
    todoist: { handle },
  });
}

function bodyOf(content: string): string {
  return splitFrontmatter(content)?.body ?? content;
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
  const action = new CaptureTodoistCreationsAction(
    vault,
    syncState,
    'Templates/ToDo.md',
    doneOptionName,
  );
  const run = (
    overrides: Partial<CaptureTodoistCreationsInput> = {},
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
  return { action, run, vault, taskManager, syncState };
}

describe('MAT-4 — a hand-made Todoist task is captured', () => {
  it('captures a top-level task and mints a record with a todoist handle', async () => {
    const { run, vault, taskManager, syncState } = setup();
    taskManager.active = [
      todoistTask({ id: 'T1', content: 'Buy milk', sectionId: 'S2' }),
    ];

    await run();

    const path = 'Projecten/Acme Widgets/taken/buy-milk.md';
    const content = vault.notes.get(path)!;
    expect(content).toContain('status: Building');
    expect(content).toContain('affiliation: ["[[_Acme Widgets]]"]');
    expect(content).not.toContain('todoist:');
    expect(content).not.toContain('url:');
    const record = await syncState.findByMirror('todoist', 'T1');
    expect(record).not.toBeNull();
    expect(record?.notePath).toBe(path);
    expect(syncState.baseOf(record!.id, 'todoist')?.status).toBe('Building');
    expect(syncState.handleOf(record!.id, 'github')).toBeNull();
  });

  it('captures a section-less task in the default lane', async () => {
    const { run, vault, taskManager } = setup();
    taskManager.active = [todoistTask({ id: 'T1', content: 'Buy milk' })];

    await run();

    expect(vault.notes.get('Projecten/Acme Widgets/taken/buy-milk.md')).toContain(
      'status: Unshaped',
    );
  });

  it("captures a subtask under a slice's twin as a slice-affiliated draft", async () => {
    const { run, vault, taskManager, syncState } = setup();
    const slicePath = 'Projecten/Acme Widgets/taken/40-slice-1.md';
    vault.notes.set(slicePath, taskNote('Body.', 'SLICE'));
    anchored(syncState, 'slice-uuid', slicePath, 'SLICE');
    taskManager.active = [
      todoistTask({ id: 'SLICE', content: 'Slice 1', labels: ['slice'] }),
      todoistTask({ id: 'T2', content: 'Write the copy', parentId: 'SLICE' }),
    ];

    await run();

    const path = 'Projecten/Acme Widgets/taken/write-the-copy.md';
    const content = vault.notes.get(path)!;
    expect(content).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[40-slice-1]]"]',
    );
    expect(content).toContain('status: Unshaped');
    expect(content).not.toContain('todoist:');
    const record = await syncState.findByMirror('todoist', 'T2');
    expect(syncState.baseOf(record!.id, 'todoist')?.parent).toBe('slice-uuid');
  });

  it("captures a subtask under a task's twin as a linked to-do", async () => {
    const { run, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Body.', 'TASK'));
    anchored(syncState, 'task-uuid', taskPath, 'TASK');
    taskManager.active = [
      todoistTask({ id: 'TASK', content: 'Chore 1', labels: ['chore'] }),
      todoistTask({ id: 'T7', content: 'Fix the widget', parentId: 'TASK' }),
    ];

    await run();

    const todoPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';
    const todo = vault.notes.get(todoPath)!;
    expect(todo).toContain('status: open');
    expect(todo).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[42-chore-1]]"]',
    );
    expect(todo).not.toContain('todoist:');
    expect(bodyOf(vault.notes.get(taskPath)!)).toContain(
      `- [ ] [[${todoPath}|Fix the widget]]`,
    );
    const record = await syncState.findByMirror('todoist', 'T7');
    expect(syncState.baseOf(record!.id, 'todoist')?.parent).toBe('task-uuid');
  });

  it('captures an already-completed item as a done note', async () => {
    const { run, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Body.', 'TASK'));
    anchored(syncState, 'task-uuid', taskPath, 'TASK');
    taskManager.completed = [
      todoistTask({ id: 'T1', content: 'Already done', isCompleted: true, completedAt: syncedAt }),
      todoistTask({ id: 'T2', content: 'Done too', parentId: 'TASK', isCompleted: true, completedAt: syncedAt }),
    ];

    await run();

    expect(
      vault.notes.get('Projecten/Acme Widgets/taken/already-done.md'),
    ).toContain('status: Shipped');
    const doneTodo = vault.notes.get(
      'Projecten/Acme Widgets/todos/done-too.md',
    )!;
    expect(doneTodo).toContain('status: completed');
    expect(doneTodo).toContain(`completed: ${syncedAt}`);
    const record = await syncState.findByMirror('todoist', 'T2');
    expect(syncState.baseOf(record!.id, 'todoist')?.completedAt).toBe(syncedAt);
  });

  it('does not re-capture an already-anchored item', async () => {
    const { run, vault, taskManager, syncState } = setup();
    const path = 'Projecten/Acme Widgets/taken/buy-milk.md';
    vault.notes.set(path, taskNote('Body.', 'T1'));
    anchored(syncState, 'uuid-t1', path, 'T1');
    taskManager.active = [todoistTask({ id: 'T1', content: 'Buy milk' })];
    const before = await syncState.list();

    await run();

    expect(vault.created).toEqual([]);
    expect(await syncState.list()).toEqual(before);
  });

  it('captures a parent and its child in one pass, parent first', async () => {
    const { run, vault, taskManager, syncState } = setup();
    taskManager.active = [
      todoistTask({ id: 'T9', content: 'New parent' }),
      todoistTask({ id: 'T2', content: 'New child', parentId: 'T9' }),
    ];

    await run();

    const parentPath = 'Projecten/Acme Widgets/taken/new-parent.md';
    const childPath = 'Projecten/Acme Widgets/todos/new-child.md';
    expect(vault.notes.has(parentPath)).toBe(true);
    expect(vault.notes.get(childPath)).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[new-parent]]"]',
    );
    const parent = await syncState.findByMirror('todoist', 'T9');
    const child = await syncState.findByMirror('todoist', 'T2');
    expect(syncState.baseOf(child!.id, 'todoist')?.parent).toBe(parent?.id);
  });

  it('waits for a child whose parent is not in the fetched set', async () => {
    const { run, vault, taskManager } = setup();
    taskManager.active = [
      todoistTask({ id: 'T2', content: 'Orphan', parentId: 'GONE' }),
    ];

    await run();

    expect(vault.created).toEqual([]);
  });
});
