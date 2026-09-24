import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../../src/Domain/Actions/SyncProjectAction.js';
import { ApplyRemoteChangeAction } from '../../../src/Domain/Actions/ApplyRemoteChangeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { ApplyBoardChangeAction } from '../../../src/Domain/Actions/ApplyBoardChangeAction.js';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: hold notes and status records in memory and record the
// operations the composed actions perform, so the orchestration (fetch →
// apply/create → board reconcile → advance cursor) is what's under test.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  written: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }

  async renameNote(): Promise<void> {
    throw new Error('not used in this test');
  }

  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  async listNotesInFolder(): Promise<string[]> {
    return [];
  }

  async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  onNoteChanged(): void {
    throw new Error('not used in this test');
  }

  onNoteDeleted(): void {
    throw new Error('not used in this test');
  }
  onNoteRenamed(): void {}
}

class FakeSyncState implements SyncStatePort {
  statuses = new Map<string, Status>();
  lastPoll: string | null = null;
  lastPollCalls: Array<{ projectName: string; iso: string }> = [];
  identity: ProjectIdentityData | null = null;

  async get(url: string): Promise<Status | null> {
    return this.statuses.get(url) ?? null;
  }

  async set(status: Status): Promise<void> {
    this.statuses.set(status.url, status);
  }

  async findByNotePath(): Promise<Status | null> {
    return null;
  }

  async remove(): Promise<void> {
    throw new Error('not used in this test');
  }

  async list(): Promise<Status[]> {
    return [...this.statuses.values()];
  }

  async getLastPoll(): Promise<string | null> {
    return this.lastPoll;
  }

  async setLastPoll(projectName: string, iso: string): Promise<void> {
    this.lastPollCalls.push({ projectName, iso });
  }

  async setIdentity(): Promise<void> {
    throw new Error('not used in this test');
  }

  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  tasks: TaskData[] = [];
  repoUrlCalls: string[] = [];
  sinceCalls: Array<string | undefined> = [];
  boardItems: BoardItemData[] = [];
  boardItemsCalls: string[] = [];
  addBoardItemCalls: Array<{ projectNodeId: string; issueUrl: string }> = [];
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }

  async fetchChangedTasks(
    repoUrl: string,
    since?: string,
  ): Promise<TaskData[]> {
    this.repoUrlCalls.push(repoUrl);
    this.sinceCalls.push(since);
    return this.tasks;
  }

  async fetchTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }

  async updateTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }

  async setTaskState(url: string, state: 'open' | 'closed'): Promise<TaskData> {
    this.stateCalls.push({ url, state });
    return {
      url,
      remoteId: 42,
      nodeId: 'I_kwDOAAAA42',
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state,
      updatedAt: '2026-09-18T12:30:00Z',
      labels: ['type: task'],
    };
  }

  async fetchBoardItems(projectNodeId: string): Promise<BoardItemData[]> {
    this.boardItemsCalls.push(projectNodeId);
    return this.boardItems;
  }

  boardStatusCalls: Array<{
    projectNodeId: string;
    statusFieldId: string;
    issueUrl: string;
    optionId: string;
  }> = [];

  async setBoardStatus(
    projectNodeId: string,
    statusFieldId: string,
    issueUrl: string,
    optionId: string,
  ): Promise<void> {
    this.boardStatusCalls.push({
      projectNodeId,
      statusFieldId,
      issueUrl,
      optionId,
    });
  }

  async addBoardItem(projectNodeId: string, issueUrl: string): Promise<void> {
    this.addBoardItemCalls.push({ projectNodeId, issueUrl });
  }

  async fetchUnpromotedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }

  async addLabel(): Promise<void> {
    throw new Error('not used in this test');
  }

  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
      statusName: 'Building',
};

const taskA: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: ['type: task'],
};

const taskB: TaskData = {
  url: 'https://github.com/acme/widgets/issues/43',
  remoteId: 43,
  nodeId: 'I_kwDOAAAA43',
  title: 'Add a feature',
  body: 'A new feature.',
  state: 'open',
  updatedAt: '2026-09-18T11:00:00Z',
  labels: ['type: task'],
};

const identity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [
    { id: 'PVTSSF_1', name: 'Unshaped' },
      { id: 'PVTSSF_2', name: 'Shaping' },
      { id: 'PVTSSF_3', name: 'Shaped' },
      { id: 'PVTSSF_4', name: 'Building' },
      { id: 'PVTSSF_5', name: 'Shipped' },
  ],
};

function makeAction(
  vault: FakeVault,
  syncState: FakeSyncState,
  projectManagement: FakeProjectManagement,
) {
  const createTaskNote = new CreateTaskNoteAction(
    vault,
    syncState,
    'Templates/Task.md',
  );
  const applyRemoteChange = new ApplyRemoteChangeAction(
    vault,
    syncState,
    createTaskNote,
    new BoardStatusAction(syncState, projectManagement),
    'Templates/Task.md',
  );
  const applyBoardChange = new ApplyBoardChangeAction(
    syncState,
    projectManagement,
    vault,
    'Done',
  );
  return new SyncProjectAction(
    projectManagement,
    syncState,
    applyRemoteChange,
    createTaskNote,
    applyBoardChange,
    'Shipped',
  );
}

describe('SyncProjectAction', () => {
  it('fetches since the last poll, applies existing and creates new, then advances the cursor', async () => {
    // Given — a last poll cursor, one task with a changed status and one new
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.lastPoll = '2026-09-18T10:00:00Z';
    syncState.identity = identity;
    const { path: pathA } = TaskNoteMapper.map(taskA, context);
    syncState.statuses.set(taskA.url, {
      url: taskA.url,
      remoteId: taskA.remoteId,
      notePath: pathA,
      lastSyncedBodyHash: hash('old body'),
      lastSyncedRemoteUpdatedAt: '2026-09-18T09:00:00Z',
      lastSyncedStatus: 'open',
      lastSyncedTitle: taskA.title,
    });
    // The existing note holds the old body, so the remote change rewrites it
    const oldTaskA: TaskData = { ...taskA, body: 'old body' };
    vault.notes.set(pathA, TaskNoteMapper.map(oldTaskA, context).content);

    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [taskA, taskB];

    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(context);

    // Then — tasks are fetched since the last poll, for the identity's repo
    expect(projectManagement.repoUrlCalls).toEqual([
      'https://github.com/acme/widgets',
    ]);
    expect(projectManagement.sinceCalls).toEqual(['2026-09-18T10:00:00Z']);
    // And the existing task is applied (rewritten) while the new one is created
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.path).toBe(pathA);
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(
      TaskNoteMapper.map(taskB, context).path,
    );
    // And the cursor is advanced to the sync time
    expect(syncState.lastPollCalls).toEqual([
      { projectName: 'Acme Widgets', iso: '2026-09-18T12:00:00Z' },
    ]);
  });

  it('skips tasks without a type label — only typed tasks are tracked', async () => {
    // Given — one task carrying a type label and one carrying none
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const typed: TaskData = { ...taskA, labels: ['type: slice'] };
    const untyped: TaskData = { ...taskB, labels: ['bug'] };
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [typed, untyped];

    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(context);

    // Then — only the typed task materializes; the untyped one is ignored
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(TaskNoteMapper.map(typed, context).path);
    expect(vault.written).toHaveLength(0);
  });

  it('passes undefined through when no last poll exists', async () => {
    // Given — no last poll cursor yet
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.lastPoll = null;
    syncState.identity = identity;
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [];
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(context);

    // Then — the since cursor is undefined (first poll fetches everything)
    expect(projectManagement.sinceCalls).toEqual([undefined]);
  });

  it('applies board-driven changes when the board disagrees with the issue', async () => {
    // Given — a project with an identity, a tracked open issue whose card is Done
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const { path: pathA } = TaskNoteMapper.map(taskA, context);
    syncState.statuses.set(taskA.url, {
      url: taskA.url,
      remoteId: taskA.remoteId,
      notePath: pathA,
      lastSyncedBodyHash: hash(taskA.body),
      lastSyncedRemoteUpdatedAt: taskA.updatedAt,
      lastSyncedStatus: 'open',
      lastSyncedTitle: taskA.title,
    });
    vault.notes.set(pathA, TaskNoteMapper.map(taskA, context).content);
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [];
    projectManagement.boardItems = [
      {
        itemId: 'PVTI_1',
        type: 'ISSUE',
        issueUrl: taskA.url,
        statusOptionName: 'Done',
      },
    ];
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(context);

    // Then — the board items are fetched once and the issue is closed
    expect(projectManagement.boardItemsCalls).toEqual(['PVT_123']);
    expect(projectManagement.stateCalls).toEqual([
      { url: taskA.url, state: 'closed' },
    ]);
  });

  it('adds a tracked task missing from the board', async () => {
    // Given — a project with an identity and a tracked task not on the board
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const { path: pathA } = TaskNoteMapper.map(taskA, context);
    syncState.statuses.set(taskA.url, {
      url: taskA.url,
      remoteId: taskA.remoteId,
      notePath: pathA,
      lastSyncedBodyHash: hash(taskA.body),
      lastSyncedRemoteUpdatedAt: taskA.updatedAt,
      lastSyncedStatus: 'open',
      lastSyncedTitle: taskA.title,
    });
    vault.notes.set(pathA, TaskNoteMapper.map(taskA, context).content);
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [];
    projectManagement.boardItems = [
      {
        itemId: 'PVTI_1',
        type: 'ISSUE',
        issueUrl: 'https://github.com/acme/widgets/issues/99',
        statusOptionName: 'Unshaped',
      },
    ];
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(context);

    // Then — the tracked task is added to the board
    expect(projectManagement.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: taskA.url },
    ]);
  });

  it('does not add a tracked task that is already on the board', async () => {
    // Given — a project with an identity and a tracked task already on the board
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const { path: pathA } = TaskNoteMapper.map(taskA, context);
    syncState.statuses.set(taskA.url, {
      url: taskA.url,
      remoteId: taskA.remoteId,
      notePath: pathA,
      lastSyncedBodyHash: hash(taskA.body),
      lastSyncedRemoteUpdatedAt: taskA.updatedAt,
      lastSyncedStatus: 'open',
      lastSyncedTitle: taskA.title,
    });
    vault.notes.set(pathA, TaskNoteMapper.map(taskA, context).content);
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [];
    projectManagement.boardItems = [
      {
        itemId: 'PVTI_1',
        type: 'ISSUE',
        issueUrl: taskA.url,
        statusOptionName: 'Unshaped',
      },
    ];
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(context);

    // Then — nothing is added to the board
    expect(projectManagement.addBoardItemCalls).toEqual([]);
  });

  it('skips the poll with a clear error when the project has no stored identity', async () => {
    // Given — a project with no stored identity (board-less)
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = null;
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [];
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    // Then — the poll is skipped with a clear error rather than crashing
    await expect(action.execute(context)).rejects.toThrow(/no repo url/);
    expect(projectManagement.sinceCalls).toEqual([]);
    expect(projectManagement.boardItemsCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
  });

  it('skips the poll with a clear error when the identity lacks a repo url', async () => {
    // Given — a project whose stored identity has no repo url
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = { ...identity, repoUrl: '' };
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [];
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    // Then — the poll is skipped with a clear error rather than crashing
    await expect(action.execute(context)).rejects.toThrow(/no repo url/);
    expect(projectManagement.sinceCalls).toEqual([]);
    expect(projectManagement.boardItemsCalls).toEqual([]);
  });
});
