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

  async moveFolder(): Promise<void> {}
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
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }

  async setLastProjectUpdate(): Promise<void> {}
  statuses = new Map<string, Status>();
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

  async setIdentity(): Promise<void> {
    throw new Error('not used in this test');
  }

  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  async setProjectClosed(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  tasks: TaskData[] = [];
  repoUrlCalls: string[] = [];
  boardItems: BoardItemData[] = [];
  boardItemsCalls: string[] = [];
  addBoardItemCalls: Array<{ projectNodeId: string; issueUrl: string }> = [];
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }

  async fetchTrackedIssues(repoUrl: string): Promise<TaskData[]> {
    this.repoUrlCalls.push(repoUrl);
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
  includeBoard: true,
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
  it('reconciles the full tracked set, applying existing and creating new', async () => {
    // Given — one task with a changed status and one new
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
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

    // Then — the full tracked set is fetched for the identity's repo
    expect(projectManagement.repoUrlCalls).toEqual([
      'https://github.com/acme/widgets',
    ]);
    // And the existing task is applied (rewritten) while the new one is created
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.path).toBe(pathA);
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(
      TaskNoteMapper.map(taskB, context).path,
    );
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
    expect(vault.created[0]!.path).toBe(
      TaskNoteMapper.map(typed, context).path,
    );
    expect(vault.written).toHaveLength(0);
  });

  it('materializes a quiet typed issue whose update predates the poll', async () => {
    // Given — a typed issue last updated long before this poll, with no
    // stored status record (it went quiet before the type filter widened)
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const quiet: TaskData = {
      ...taskA,
      updatedAt: '2026-09-01T00:00:00Z',
      labels: ['type: bug'],
    };
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [quiet];
    const action = makeAction(vault, syncState, projectManagement);

    // When — a normal poll runs
    await action.execute(context);

    // Then — the quiet issue materializes, because every poll reconciles the
    // complete tracked set rather than only what changed since a cursor
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(
      TaskNoteMapper.map(quiet, context).path,
    );
  });

  it('performs no writes on a second poll over a settled project', async () => {
    // Given — a tracked issue already on the board in its implied lane
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [taskA];
    projectManagement.boardItems = [
      {
        itemId: 'PVTI_1',
        type: 'ISSUE',
        issueUrl: taskA.url,
        statusOptionName: 'Unshaped',
      },
    ];
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is polled twice
    await action.execute(context);
    expect(vault.created).toHaveLength(1);
    vault.created = [];
    vault.written = [];
    await action.execute(context);

    // Then — the settled second poll writes nothing: the sync state is the diff
    expect(vault.created).toHaveLength(0);
    expect(vault.written).toHaveLength(0);
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

  it("materializes a board card's issue before the board loop applies its lane", async () => {
    // Given — a tracked issue with no status record yet, whose card is Done
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [taskA];
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

    // Then — the task loop materialized the issue first, so the board loop
    // could close it; a board-first order would have skipped the untracked card
    expect(vault.created).toHaveLength(1);
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
    expect(projectManagement.repoUrlCalls).toEqual([]);
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
    expect(projectManagement.repoUrlCalls).toEqual([]);
    expect(projectManagement.boardItemsCalls).toEqual([]);
  });

  it('skips the board fetch and its bookkeeping when the board is excluded', async () => {
    // Given — a tracked task missing from the board, which bookkeeping would add
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [taskA];
    projectManagement.boardItems = [];
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced without the board
    await action.execute({ ...context, includeBoard: false });

    // Then — the tracked set is still reconciled, but the board is never touched
    expect(projectManagement.repoUrlCalls).toEqual([
      'https://github.com/acme/widgets',
    ]);
    expect(vault.created).toHaveLength(1);
    expect(projectManagement.boardItemsCalls).toEqual([]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
  });
});
