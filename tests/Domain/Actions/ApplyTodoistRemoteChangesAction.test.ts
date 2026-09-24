import { describe, expect, it } from 'vitest';
import { ApplyTodoistRemoteChangesAction } from '../../../src/Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistStateData } from '../../../src/Domain/DataTransferObjects/TodoistStateData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the vault holds the mirrored notes and records every
// write and rename; the task manager serves the active and completed sets; the
// sync state holds the per-item bookkeeping and the project's lane map; and the
// three GitHub-side actions the verdict drives (status propagation, the task
// relocate and the to-do relink) are recording stubs. The verdict's decisions —
// what to apply, what to skip, and what to re-stamp — are what's under test.
class FakeVault implements VaultPort {
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

class FakeSyncState implements SyncStatePort {
  identity: ProjectIdentityData | null = null;
  projectState: TodoistProjectStateData | null = null;
  todoistItemStates = new Map<string, TodoistStateData>();
  todoistItemSets: Array<{ notePath: string; state: TodoistStateData }> = [];
  todoistItemRemovals: string[] = [];

  async getTodoistProjectState(): Promise<TodoistProjectStateData | null> {
    return this.projectState;
  }
  async setTodoistProjectState(): Promise<void> {}
  async getTodoistState(notePath: string): Promise<TodoistStateData | null> {
    return this.todoistItemStates.get(notePath) ?? null;
  }
  async setTodoistState(
    notePath: string,
    state: TodoistStateData,
  ): Promise<void> {
    this.todoistItemSets.push({ notePath, state });
    this.todoistItemStates.set(notePath, state);
  }
  async listTodoistStates(): Promise<TodoistStateData[]> {
    return [...this.todoistItemStates.values()];
  }
  async removeTodoistState(notePath: string): Promise<void> {
    this.todoistItemStates.delete(notePath);
    this.todoistItemRemovals.push(notePath);
  }

  async get(): Promise<Status | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return [];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
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
const projectId = 'P1';
const syncedAt = '2026-09-24T12:00:00Z';
const doneOptionName = 'Shipped';
const choreUrl = 'https://github.com/acme/widgets/issues/42';

const identity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [
    { id: 'PVTSSF_1', name: 'Unshaped' },
    { id: 'PVTSSF_2', name: 'Building' },
    { id: 'PVTSSF_3', name: 'Shipped' },
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

function twin(
  id: string,
  content: string,
  overrides: Partial<TodoistTaskData> = {},
): TodoistTaskData {
  return {
    id,
    projectId,
    sectionId: null,
    parentId: null,
    content,
    labels: [],
    isCompleted: false,
    url: `https://app.todoist.com/app/task/${id}`,
    ...overrides,
  };
}

function state(
  notePath: string,
  overrides: Partial<TodoistStateData> = {},
): TodoistStateData {
  return {
    todoistId: 'T1',
    notePath,
    lastSyncedHash: 'stale',
    lastSyncedCompleted: false,
    lastSyncedContent: 'Chore 1',
    lastSyncedLane: null,
    lastSyncedParent: null,
    ...overrides,
  };
}

function setup() {
  const vault = new FakeVault();
  const taskManager = new FakeTaskManager();
  const syncState = new FakeSyncState();
  syncState.identity = identity;
  syncState.projectState = {
    sections,
    lastCompletedPoll: '2026-09-24T11:00:00Z',
  };
  const propagateStatus = new FakePropagateStatus();
  const relocateTaskStatus = new FakeRelocateTaskStatus();
  const relinkRenamedTodo = new FakeRelinkRenamedTodo();
  const action = new ApplyTodoistRemoteChangesAction(
    taskManager,
    vault,
    syncState,
    propagateStatus as never,
    relocateTaskStatus as never,
    relinkRenamedTodo as never,
    doneOptionName,
  );
  return {
    action,
    vault,
    taskManager,
    syncState,
    propagateStatus,
    relocateTaskStatus,
    relinkRenamedTodo,
  };
}

describe('ApplyTodoistRemoteChangesAction', () => {
  it('renames a to-do note when Todoist renamed the twin, relinking the checklist', async () => {
    // Given — a to-do note whose twin was renamed in Todoist
    const { action, vault, taskManager, syncState, relinkRenamedTodo } =
      setup();
    const todoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
    vault.notes.set(
      todoPath,
      taskNote('open', ['[[Acme Widgets]]', '[[42-chore-1]]'], null),
    );
    syncState.todoistItemStates.set(
      todoPath,
      state(todoPath, {
        todoistId: 'T2',
        lastSyncedContent: 'Fix the bug',
        lastSyncedParent: 'T1',
      }),
    );
    taskManager.active = [twin('T2', 'Fix the widget', { parentId: 'T1' })];

    // When — the remote rename is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the note is renamed to the content's slug, not rewritten
    const newPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';
    expect(vault.renames).toEqual([{ oldPath: todoPath, newPath }]);
    expect(vault.writes).toEqual([]);
    // And the checklist relink machinery follows the rename
    expect(relinkRenamedTodo.calls).toEqual([
      { oldPath: todoPath, newPath, syncedAt },
    ]);
    // And the snapshot is re-stamped at the new path
    expect(syncState.todoistItemSets[0]!.notePath).toBe(newPath);
    expect(syncState.todoistItemSets[0]!.state.lastSyncedContent).toBe(
      'Fix the widget',
    );
  });

  it('renames a task note keeping its issue-id prefix', async () => {
    // Given — an issue-backed task note whose twin was renamed in Todoist
    const { action, vault, taskManager, syncState, relocateTaskStatus } =
      setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    syncState.todoistItemStates.set(
      taskPath,
      state(taskPath, { lastSyncedLane: 'Unshaped' }),
    );
    taskManager.active = [twin('T1', 'Chore 1 renamed')];

    // When — the remote rename is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the rename keeps the numeric prefix and relocates the bookkeeping
    const newPath = 'Projecten/Acme Widgets/taken/42-chore-1-renamed.md';
    expect(vault.renames).toEqual([{ oldPath: taskPath, newPath }]);
    expect(relocateTaskStatus.calls).toEqual([{ oldPath: taskPath, newPath }]);
  });

  it('moves the note and the board card when Todoist dragged a top-level task to a lane', async () => {
    // Given — an issue-backed task in Unshaped whose twin sits in Building
    const { action, vault, taskManager, syncState, propagateStatus } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    syncState.todoistItemStates.set(
      taskPath,
      state(taskPath, { lastSyncedLane: 'Unshaped' }),
    );
    taskManager.active = [twin('T1', 'Chore 1', { sectionId: 'S2' })];

    // When — the remote lane drag is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the note's status follows the lane
    expect(vault.writes[0]!.content).toContain('status: Building');
    // And the issue-backed note propagates the lane (issue state + board card)
    expect(propagateStatus.calls).toEqual([
      {
        url: choreUrl,
        statusName: 'Building',
        notePath: taskPath,
        projectName,
      },
    ]);
    // And the snapshot now records the new lane
    expect(syncState.todoistItemSets[0]!.state.lastSyncedLane).toBe('Building');
  });

  it('moves only the note when the dragged item has no GitHub issue', async () => {
    // Given — a captured draft (no url) whose twin sits in Building
    const { action, vault, taskManager, syncState, propagateStatus } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/capture-me.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]'], null));
    syncState.todoistItemStates.set(
      taskPath,
      state(taskPath, {
        lastSyncedContent: 'Capture me',
        lastSyncedLane: 'Unshaped',
      }),
    );
    taskManager.active = [twin('T1', 'Capture me', { sectionId: 'S2' })];

    // When — the remote lane drag is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the note's status moves and no GitHub write is attempted
    expect(vault.writes[0]!.content).toContain('status: Building');
    expect(propagateStatus.calls).toEqual([]);
  });

  it('gains the slice affiliation when a task is dragged under a slice twin', async () => {
    // Given — a top-level task whose twin was dragged under slice T1
    const { action, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    const slicePath = 'Projecten/Acme Widgets/taken/40-slice-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    vault.notes.set(
      slicePath,
      taskNote('Unshaped', ['[[Acme Widgets]]'], null),
    );
    // The task's own twin is T9; the slice's is T1.
    syncState.todoistItemStates.set(
      slicePath,
      state(slicePath, { todoistId: 'T1' }),
    );
    syncState.todoistItemStates.set(
      taskPath,
      state(taskPath, { todoistId: 'T9' }),
    );
    taskManager.active = [twin('T9', 'Chore 1', { parentId: 'T1' })];

    // When — the parent change is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the affiliation gains the slice link
    expect(vault.writes[0]!.content).toContain(
      'affiliation: ["[[Acme Widgets]]", "[[40-slice-1]]"]',
    );
    expect(syncState.todoistItemSets[0]!.state.lastSyncedParent).toBe('T1');
  });

  it('drops the slice affiliation when a task is dragged back to top level', async () => {
    // Given — a slice-affiliated task whose twin is top-level again
    const { action, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    const slicePath = 'Projecten/Acme Widgets/taken/40-slice-1.md';
    vault.notes.set(
      taskPath,
      taskNote('Unshaped', ['[[Acme Widgets]]', '[[40-slice-1]]']),
    );
    vault.notes.set(
      slicePath,
      taskNote('Unshaped', ['[[Acme Widgets]]'], null),
    );
    syncState.todoistItemStates.set(
      slicePath,
      state(slicePath, { todoistId: 'T1' }),
    );
    syncState.todoistItemStates.set(
      taskPath,
      state(taskPath, { lastSyncedLane: 'Unshaped', lastSyncedParent: 'T1' }),
    );
    taskManager.active = [twin('T1', 'Chore 1')];

    // When — the parent change is applied
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the slice link is dropped
    expect(vault.writes[0]!.content).toContain(
      'affiliation: ["[[Acme Widgets]]"]',
    );
    expect(syncState.todoistItemSets[0]!.state.lastSyncedParent).toBeNull();
  });

  it('lets the vault win when both sides changed', async () => {
    // Given — the note moved lane (vault) and the twin was renamed (remote)
    const { action, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Building', ['[[Acme Widgets]]']));
    syncState.todoistItemStates.set(
      taskPath,
      state(taskPath, { lastSyncedLane: 'Unshaped' }),
    );
    taskManager.active = [twin('T1', 'Chore 1 renamed', { sectionId: 'S1' })];

    // When — the verdict runs
    await action.execute({ projectName, projectId, syncedAt });

    // Then — neither the rename nor the lane is applied (the vault wins)
    expect(vault.renames).toEqual([]);
    expect(vault.writes).toEqual([]);
    // And the snapshot is re-stamped from the remote either way
    expect(syncState.todoistItemSets).toHaveLength(1);
    expect(syncState.todoistItemSets[0]!.state.lastSyncedContent).toBe(
      'Chore 1 renamed',
    );
  });

  it('ignores a section change on a subtask (it inherits its parent)', async () => {
    // Given — a slice child whose twin shows its parent's section
    const { action, vault, taskManager, syncState } = setup();
    const childPath = 'Projecten/Acme Widgets/taken/41-chore-1.md';
    const slicePath = 'Projecten/Acme Widgets/taken/40-slice-1.md';
    vault.notes.set(
      childPath,
      taskNote('Unshaped', ['[[Acme Widgets]]', '[[40-slice-1]]']),
    );
    vault.notes.set(
      slicePath,
      taskNote('Unshaped', ['[[Acme Widgets]]'], null),
    );
    syncState.todoistItemStates.set(
      slicePath,
      state(slicePath, { todoistId: 'SLICE' }),
    );
    syncState.todoistItemStates.set(
      childPath,
      state(childPath, { lastSyncedParent: 'SLICE' }),
    );
    taskManager.active = [
      twin('T1', 'Chore 1', { parentId: 'SLICE', sectionId: 'S2' }),
    ];

    // When — the verdict runs
    await action.execute({ projectName, projectId, syncedAt });

    // Then — no lane is applied and nothing is re-stamped
    expect(vault.writes).toEqual([]);
    expect(syncState.todoistItemSets).toEqual([]);
  });

  it('treats a completed top-level task as sitting in the done lane', async () => {
    // Given — a section-less twin the vault has not seen as done
    const { action, vault, taskManager, syncState, propagateStatus } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    syncState.todoistItemStates.set(
      taskPath,
      state(taskPath, { lastSyncedLane: 'Unshaped' }),
    );
    taskManager.active = [twin('T1', 'Chore 1', { isCompleted: true })];

    // When — the verdict runs
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the note moves to the done lane
    expect(vault.writes[0]!.content).toContain('status: Shipped');
    expect(propagateStatus.calls[0]!.statusName).toBe('Shipped');
  });

  it('fills a missing per-field base without applying a remote change', async () => {
    // Given — a pre-t5 record with no per-field bases
    const { action, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    syncState.todoistItemStates.set(taskPath, {
      todoistId: 'T1',
      notePath: taskPath,
      lastSyncedHash: 'stale',
      lastSyncedCompleted: false,
    });
    taskManager.active = [twin('T1', 'Chore 1')];

    // When — the verdict runs
    await action.execute({ projectName, projectId, syncedAt });

    // Then — nothing is applied to the vault, but the bases are stamped
    expect(vault.writes).toEqual([]);
    expect(syncState.todoistItemSets[0]!.state.lastSyncedContent).toBe(
      'Chore 1',
    );
    expect(syncState.todoistItemSets[0]!.state.lastSyncedLane).toBe('Unshaped');
  });

  it('is idempotent: a settled item is not touched on a second pass', async () => {
    // Given — a lane drag applied once
    const { action, vault, taskManager, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    syncState.todoistItemStates.set(
      taskPath,
      state(taskPath, { lastSyncedLane: 'Unshaped' }),
    );
    taskManager.active = [twin('T1', 'Chore 1', { sectionId: 'S2' })];
    await action.execute({ projectName, projectId, syncedAt });
    vault.writes = [];
    syncState.todoistItemSets = [];

    // When — the same remote state is seen again
    await action.execute({ projectName, projectId, syncedAt });

    // Then — no vault write and no snapshot churn
    expect(vault.writes).toEqual([]);
    expect(syncState.todoistItemSets).toEqual([]);
  });

  it('evicts the record of a twin deleted in Todoist so the projection re-creates it', async () => {
    // Given — a note that survives whose twin is in neither fetched set
    const { action, vault, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    vault.notes.set(taskPath, taskNote('Unshaped', ['[[Acme Widgets]]']));
    syncState.todoistItemStates.set(taskPath, state(taskPath));

    // When — the verdict runs
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the record is evicted (not deleted in the vault, not applied), so
    // the projection re-creates the twin later in this same tick (vault wins)
    expect(syncState.todoistItemRemovals).toEqual([taskPath]);
    expect(vault.writes).toEqual([]);
    expect(vault.renames).toEqual([]);
  });

  it('keeps the record when the twin completed (present in the completed window)', async () => {
    // Given — a to-do whose twin is absent from the active set but completed
    const { action, vault, taskManager, syncState } = setup();
    const todoPath = 'Projecten/Acme Widgets/todos/fix-the-widget.md';
    vault.notes.set(
      todoPath,
      taskNote('open', ['[[Acme Widgets]]', '[[42-chore-1]]'], null),
    );
    syncState.todoistItemStates.set(
      todoPath,
      state(todoPath, {
        todoistId: 'T2',
        lastSyncedContent: 'Fix the bug',
        lastSyncedParent: 'TASK',
      }),
    );
    taskManager.completed = [
      twin('T2', 'Fix the bug', { parentId: 'TASK', isCompleted: true }),
    ];

    // When — the verdict runs
    await action.execute({ projectName, projectId, syncedAt });

    // Then — completion is not a deletion: the record survives untouched
    expect(syncState.todoistItemRemovals).toEqual([]);
    expect(syncState.todoistItemStates.has(todoPath)).toBe(true);
  });

  it('leaves a missing note to the deletion action', async () => {
    // Given — a deleted note whose twin is gone too
    const { action, syncState } = setup();
    const taskPath = 'Projecten/Acme Widgets/taken/42-chore-1.md';
    syncState.todoistItemStates.set(taskPath, state(taskPath));

    // When — the verdict runs
    await action.execute({ projectName, projectId, syncedAt });

    // Then — nothing is evicted here; PropagateTodoistDeletionsAction owns the
    // vault-deletion direction (and evicts the record with the twin)
    expect(syncState.todoistItemRemovals).toEqual([]);
    expect(syncState.todoistItemStates.has(taskPath)).toBe(true);
  });
});
