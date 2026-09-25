import { describe, expect, it } from 'vitest';
import { EnsureTodoistSectionsAction } from '../../../src/Domain/Actions/EnsureTodoistSectionsAction.js';
import { ProjectTasksToTodoistAction } from '../../../src/Domain/Actions/ProjectTasksToTodoistAction.js';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistStateData } from '../../../src/Domain/DataTransferObjects/TodoistStateData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the vault holds note content and records writes, the task
// manager holds the project's sections and tasks and records every mutation,
// the project management port serves the tracked issue set, and the sync state
// holds the identity, the per-note Status records and the Todoist bookkeeping.
// The projection's shape decisions are what's under test, and the fakes' real
// mutation is what makes idempotency observable.
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
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return [];
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeTaskManager implements TaskManagerPort {
  sections: TodoistSectionData[] = [];
  tasks: TodoistTaskData[] = [];
  labels: string[] = [];
  createTaskCalls: CreateTodoistTaskData[] = [];
  updateTaskCalls: Array<{ id: string; content: string; labels: string[] }> =
    [];
  moveTaskCalls: Array<{
    id: string;
    to: { sectionId?: string; parentId?: string };
  }> = [];
  completeCalls: Array<{ id: string; completed: boolean }> = [];
  ensureLabelCalls: string[] = [];
  private nextSectionId = 1;
  private nextTaskId = 1;

  async fetchSections(projectId: string): Promise<TodoistSectionData[]> {
    return this.sections.filter((section) => section.projectId === projectId);
  }
  async createSection(
    projectId: string,
    name: string,
  ): Promise<TodoistSectionData> {
    const section = { id: `S${this.nextSectionId++}`, projectId, name };
    this.sections.push(section);
    return section;
  }
  async updateSection(id: string, name: string): Promise<void> {
    const section = this.sections.find((candidate) => candidate.id === id);
    if (section) {
      section.name = name;
    }
  }
  async fetchActiveTasks(projectId: string): Promise<TodoistTaskData[]> {
    return this.tasks.filter(
      (task) => task.projectId === projectId && !task.isCompleted,
    );
  }
  async createTask(input: CreateTodoistTaskData): Promise<TodoistTaskData> {
    this.createTaskCalls.push(input);
    const id = `T${this.nextTaskId++}`;
    const task: TodoistTaskData = {
      id,
      projectId: input.projectId,
      sectionId: input.sectionId ?? null,
      parentId: input.parentId ?? null,
      content: input.content,
      labels: input.labels ?? [],
      isCompleted: false,
      url: `https://app.todoist.com/app/task/${id}`,
    };
    this.tasks.push(task);
    return task;
  }
  async updateTask(
    id: string,
    input: { content: string; labels: string[] },
  ): Promise<void> {
    this.updateTaskCalls.push({ id, ...input });
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (task) {
      task.content = input.content;
      task.labels = input.labels;
    }
  }
  async moveTask(
    id: string,
    to: { sectionId?: string; parentId?: string },
  ): Promise<void> {
    this.moveTaskCalls.push({ id, to });
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (task) {
      if (to.sectionId !== undefined) {
        task.sectionId = to.sectionId;
      }
      if (to.parentId !== undefined) {
        task.parentId = to.parentId;
      }
    }
  }
  async setTaskCompleted(id: string, completed: boolean): Promise<void> {
    this.completeCalls.push({ id, completed });
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (task) {
      task.isCompleted = completed;
    }
  }
  async ensureLabel(name: string): Promise<void> {
    this.ensureLabelCalls.push(name);
    if (!this.labels.includes(name)) {
      this.labels.push(name);
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
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async deleteTask(): Promise<never> {
    throw new Error('not used in this test');
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  issues: GithubTaskData[] = [];

  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return this.issues;
  }

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<never> {
    throw new Error('not used in this test');
  }
  async lockIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchUnpromotedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setTaskState(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setBoardStatus(): Promise<never> {
    throw new Error('not used in this test');
  }
  async addBoardItem(): Promise<never> {
    throw new Error('not used in this test');
  }
  async addLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

class FakeSyncState implements SyncStatePort {
  identity: ProjectIdentityData | null = null;
  statuses = new Map<string, Status>();
  todoistProjectStates = new Map<string, TodoistProjectStateData>();
  todoistItemStates = new Map<string, TodoistStateData>();
  todoistProjectSets: Array<{
    projectName: string;
    state: TodoistProjectStateData;
  }> = [];
  todoistItemSets: Array<{ notePath: string; state: TodoistStateData }> = [];

  async get(url: string): Promise<Status | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: Status): Promise<void> {
    this.statuses.set(status.url, status);
  }
  async findByNotePath(): Promise<null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return [...this.statuses.values()];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
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
  async getTodoistProjectState(
    projectName: string,
  ): Promise<TodoistProjectStateData | null> {
    return this.todoistProjectStates.get(projectName) ?? null;
  }
  async setTodoistProjectState(
    projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    this.todoistProjectSets.push({ projectName, state });
    this.todoistProjectStates.set(projectName, state);
  }
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
  }
}

const projectName = 'Acme Widgets';
const projectId = 'P1';
const syncedAt = '2026-09-24T12:00:00Z';
const doneOptionName = 'Shipped';

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

const sliceUrl = 'https://github.com/acme/widgets/issues/40';
const childUrl = 'https://github.com/acme/widgets/issues/41';
const topUrl = 'https://github.com/acme/widgets/issues/42';

const slicePath = 'Projecten/Acme Widgets/taken/40-slice-1.md';
const childPath = 'Projecten/Acme Widgets/taken/41-chore-1.md';
const topPath = 'Projecten/Acme Widgets/taken/42-bug-1.md';

function issue(
  url: string,
  title: string,
  type: string,
  state: 'open' | 'closed' = 'open',
): GithubTaskData {
  return {
    url,
    remoteId: 0,
    nodeId: '',
    title,
    body: '',
    state,
    updatedAt: '',
    labels: [`type: ${type}`],
  };
}

function taskNote(url: string, status: string, affiliation: string[]): string {
  return [
    '---',
    `url: ${url}`,
    `status: ${status}`,
    `affiliation: [${affiliation.map((link) => `"${link}"`).join(', ')}]`,
    '---',
    'Body.',
  ].join('\n');
}

function statusRecord(url: string, notePath: string): Status {
  return {
    url,
    remoteId: 0,
    notePath,
    lastSyncedBodyHash: '',
    lastSyncedRemoteUpdatedAt: '',
    lastSyncedStatus: '',
    lastSyncedTitle: '',
  };
}

function setup() {
  const vault = new FakeVault();
  const taskManager = new FakeTaskManager();
  const projectManagement = new FakeProjectManagement();
  const syncState = new FakeSyncState();
  syncState.identity = identity;
  syncState.todoistProjectStates.set(projectName, {
    sections: {},
    lastCompletedPoll: syncedAt,
  });
  const action = new ProjectTasksToTodoistAction(
    taskManager,
    projectManagement,
    vault,
    syncState,
    new EnsureTodoistSectionsAction(taskManager),
    doneOptionName,
  );
  return { action, vault, taskManager, projectManagement, syncState };
}

// Seeds the three tracked tasks: a slice, a chore affiliated to it, and an
// unaffiliated bug. The slice and the bug sit in Unshaped; the chore inherits
// the slice's section.
function seedFullShape(
  vault: FakeVault,
  projectManagement: FakeProjectManagement,
  syncState: FakeSyncState,
): void {
  projectManagement.issues = [
    issue(sliceUrl, 'Slice 1', 'slice'),
    issue(childUrl, 'Chore 1', 'chore'),
    issue(topUrl, 'Bug 1', 'bug'),
  ];
  vault.notes.set(
    slicePath,
    taskNote(sliceUrl, 'Unshaped', ['[[Acme Widgets]]']),
  );
  vault.notes.set(
    childPath,
    taskNote(childUrl, 'Unshaped', ['[[Acme Widgets]]', '[[40-slice-1]]']),
  );
  vault.notes.set(topPath, taskNote(topUrl, 'Unshaped', ['[[Acme Widgets]]']));
  syncState.statuses.set(sliceUrl, statusRecord(sliceUrl, slicePath));
  syncState.statuses.set(childUrl, statusRecord(childUrl, childPath));
  syncState.statuses.set(topUrl, statusRecord(topUrl, topPath));
}

describe('ProjectTasksToTodoistAction', () => {
  it('materializes the full shape: slice parent, affiliated child, unaffiliated top-level', async () => {
    // Given — a fresh project with a slice, a chore under it and a bug
    const { action, vault, taskManager, projectManagement, syncState } =
      setup();
    seedFullShape(vault, projectManagement, syncState);

    // When — the tasks are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the slice is a top-level task in its lane section, labeled slice
    expect(taskManager.createTaskCalls[0]).toEqual({
      projectId,
      sectionId: 'S1',
      content: 'Slice 1',
      labels: ['slice'],
      description: sliceUrl,
    });
    // And the chore is a subtask of the slice, labeled chore, with no section
    expect(taskManager.createTaskCalls[1]).toEqual({
      projectId,
      parentId: 'T1',
      content: 'Chore 1',
      labels: ['chore'],
      description: childUrl,
    });
    // And the bug is a top-level task in its lane section, labeled bug
    expect(taskManager.createTaskCalls[2]).toEqual({
      projectId,
      sectionId: 'S1',
      content: 'Bug 1',
      labels: ['bug'],
      description: topUrl,
    });
    // And every label was ensured before use
    expect(taskManager.ensureLabelCalls).toEqual(['slice', 'chore', 'bug']);
    // And each note carries its twin's anchor
    expect(vault.notes.get(slicePath)).toContain('todoist: T1');
    expect(vault.notes.get(childPath)).toContain('todoist: T2');
    expect(vault.notes.get(topPath)).toContain('todoist: T3');
  });

  it('re-creates the twin when its record is gone, re-stamping a stale anchor (self-heal)', async () => {
    // Given — a tracked task whose note still carries a stale anchor but whose
    // sync-state record was evicted (its Todoist twin was deleted)
    const { action, vault, taskManager, projectManagement, syncState } =
      setup();
    projectManagement.issues = [issue(topUrl, 'Bug 1', 'bug')];
    vault.notes.set(
      topPath,
      [
        '---',
        `url: ${topUrl}`,
        'status: Unshaped',
        'affiliation: ["[[Acme Widgets]]"]',
        'todoist: GONE',
        '---',
        'Body.',
      ].join('\n'),
    );
    syncState.statuses.set(topUrl, statusRecord(topUrl, topPath));

    // When — the tasks are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — a fresh twin is created (vault wins) and the stale anchor replaced
    expect(taskManager.createTaskCalls).toHaveLength(1);
    expect(vault.notes.get(topPath)).toContain('todoist: T1');
    expect(vault.notes.get(topPath)).not.toContain('todoist: GONE');
  });

  it('lands a subtask under its slice without its own section', async () => {
    // Given — a slice and a chore affiliated to it
    const { action, vault, taskManager, projectManagement, syncState } =
      setup();
    seedFullShape(vault, projectManagement, syncState);

    // When — the tasks are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the chore is placed by parent alone; it inherits the slice's
    // section (dt-02), so no section is set on it
    const child = taskManager.createTaskCalls[1]!;
    expect(child.parentId).toBe('T1');
    expect(child.sectionId).toBeUndefined();
  });

  it('projects a done-lane task as completed', async () => {
    // Given — a slice whose note sits in the done lane
    const { action, vault, taskManager, projectManagement, syncState } =
      setup();
    projectManagement.issues = [issue(sliceUrl, 'Slice 1', 'slice')];
    vault.notes.set(
      slicePath,
      taskNote(sliceUrl, doneOptionName, ['[[Acme Widgets]]']),
    );
    syncState.statuses.set(sliceUrl, statusRecord(sliceUrl, slicePath));

    // When — the task is projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the twin is created in the done lane's section and completed
    expect(taskManager.createTaskCalls[0]!.sectionId).toBe('S3');
    expect(taskManager.completeCalls).toEqual([{ id: 'T1', completed: true }]);
  });

  it('reopens a completed twin when the vault says active', async () => {
    // Given — a note in an open lane whose twin is completed (absent from the
    // active set)
    const { action, vault, taskManager, projectManagement, syncState } =
      setup();
    projectManagement.issues = [issue(sliceUrl, 'Slice 1', 'slice')];
    vault.notes.set(
      slicePath,
      taskNote(sliceUrl, 'Unshaped', ['[[Acme Widgets]]']),
    );
    syncState.statuses.set(sliceUrl, statusRecord(sliceUrl, slicePath));
    syncState.todoistItemStates.set(slicePath, {
      todoistId: 'T1',
      notePath: slicePath,
      lastSyncedHash: 'stale',
      lastSyncedCompleted: false,
    });
    taskManager.tasks.push({
      id: 'T1',
      projectId,
      sectionId: 'S1',
      parentId: null,
      content: 'Slice 1',
      labels: ['slice'],
      isCompleted: true,
      url: 'https://app.todoist.com/app/task/T1',
    });

    // When — the task is projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the twin is reopened
    expect(taskManager.completeCalls).toEqual([{ id: 'T1', completed: false }]);
  });

  it('moves a top-level twin when its lane changes', async () => {
    // Given — a note moved to the Building lane whose twin still sits in
    // Unshaped
    const { action, vault, taskManager, projectManagement, syncState } =
      setup();
    projectManagement.issues = [issue(sliceUrl, 'Slice 1', 'slice')];
    vault.notes.set(
      slicePath,
      taskNote(sliceUrl, 'Building', ['[[Acme Widgets]]']),
    );
    syncState.statuses.set(sliceUrl, statusRecord(sliceUrl, slicePath));
    syncState.todoistItemStates.set(slicePath, {
      todoistId: 'T1',
      notePath: slicePath,
      lastSyncedHash: 'stale',
      lastSyncedCompleted: false,
    });
    taskManager.tasks.push({
      id: 'T1',
      projectId,
      sectionId: 'S1',
      parentId: null,
      content: 'Slice 1',
      labels: ['slice'],
      isCompleted: false,
      url: 'https://app.todoist.com/app/task/T1',
    });

    // When — the task is projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the twin is moved into the new lane's section
    expect(taskManager.moveTaskCalls).toEqual([
      { id: 'T1', to: { sectionId: 'S2' } },
    ]);
  });

  it('overwrites label drift on the twin', async () => {
    // Given — a twin whose labels drifted from the derived set
    const { action, vault, taskManager, projectManagement, syncState } =
      setup();
    projectManagement.issues = [issue(topUrl, 'Bug 1', 'bug')];
    vault.notes.set(
      topPath,
      taskNote(topUrl, 'Unshaped', ['[[Acme Widgets]]']),
    );
    syncState.statuses.set(topUrl, statusRecord(topUrl, topPath));
    syncState.todoistItemStates.set(topPath, {
      todoistId: 'T1',
      notePath: topPath,
      lastSyncedHash: 'stale',
      lastSyncedCompleted: false,
    });
    taskManager.tasks.push({
      id: 'T1',
      projectId,
      sectionId: 'S1',
      parentId: null,
      content: 'Bug 1',
      labels: ['wrong'],
      isCompleted: false,
      url: 'https://app.todoist.com/app/task/T1',
    });

    // When — the task is projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — the derived label set replaces the drift
    expect(taskManager.updateTaskCalls).toEqual([
      { id: 'T1', content: 'Bug 1', labels: ['bug'] },
    ]);
  });

  it('is idempotent: a second pass over a settled project writes nothing', async () => {
    // Given — a project projected once
    const { action, vault, taskManager, projectManagement, syncState } =
      setup();
    seedFullShape(vault, projectManagement, syncState);
    await action.execute({ projectName, projectId, syncedAt });
    taskManager.createTaskCalls = [];
    taskManager.updateTaskCalls = [];
    taskManager.moveTaskCalls = [];
    taskManager.completeCalls = [];
    taskManager.ensureLabelCalls = [];

    // When — the same project is projected again
    await action.execute({ projectName, projectId, syncedAt });

    // Then — no Todoist write is made
    expect(taskManager.createTaskCalls).toEqual([]);
    expect(taskManager.updateTaskCalls).toEqual([]);
    expect(taskManager.moveTaskCalls).toEqual([]);
    expect(taskManager.completeCalls).toEqual([]);
    expect(taskManager.ensureLabelCalls).toEqual([]);
  });

  it('stamps a snapshot after each write', async () => {
    // Given — a fresh project
    const { action, vault, projectManagement, syncState } = setup();
    seedFullShape(vault, projectManagement, syncState);

    // When — the tasks are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — every mirrored item carries its twin id and a snapshot hash
    expect(syncState.todoistItemSets).toEqual([
      {
        notePath: slicePath,
        state: {
          todoistId: 'T1',
          notePath: slicePath,
          lastSyncedHash: expect.any(String),
          lastSyncedCompleted: false,
          lastSyncedContent: 'Slice 1',
          lastSyncedLane: 'Unshaped',
          lastSyncedParent: null,
        },
      },
      {
        notePath: childPath,
        state: {
          todoistId: 'T2',
          notePath: childPath,
          lastSyncedHash: expect.any(String),
          lastSyncedCompleted: false,
          lastSyncedContent: 'Chore 1',
          lastSyncedLane: null,
          lastSyncedParent: 'T1',
        },
      },
      {
        notePath: topPath,
        state: {
          todoistId: 'T3',
          notePath: topPath,
          lastSyncedHash: expect.any(String),
          lastSyncedCompleted: false,
          lastSyncedContent: 'Bug 1',
          lastSyncedLane: 'Unshaped',
          lastSyncedParent: null,
        },
      },
    ]);
    for (const { state } of syncState.todoistItemSets) {
      expect(state.lastSyncedHash).not.toBe('');
    }
  });

  it('does nothing for a project without a GitHub attach', async () => {
    // Given — a project with no stored identity
    const { action, taskManager, projectManagement, syncState } = setup();
    syncState.identity = null;
    projectManagement.issues = [issue(sliceUrl, 'Slice 1', 'slice')];

    // When — the tasks are projected
    await action.execute({ projectName, projectId, syncedAt });

    // Then — no section and no task is written
    expect(taskManager.sections).toEqual([]);
    expect(taskManager.createTaskCalls).toEqual([]);
  });
});
