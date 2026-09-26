import { describe, expect, it } from 'vitest';
import { ApplyTaskToGithubAction } from '../../../src/Domain/Actions/ApplyTaskToGithubAction.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import { taskRecord } from '../../helpers/records.js';

// Fakes at the ports: record the writes the writer asks for, so its field-level
// gates (write only what differs) are what's under test.
class FakeSyncState implements SyncStatePort {
  identity: ProjectIdentityData | null = null;
  statuses = new Map<string, TaskData>();
  setCalls: TaskData[] = [];

  async get(url: string): Promise<TaskData | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: TaskData): Promise<void> {
    this.statuses.set(status.url, status);
    this.setCalls.push(status);
  }
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
  async findByNotePath(): Promise<TaskData | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<TaskData[]> {
    return [...this.statuses.values()];
  }
  async setIdentity(): Promise<void> {}
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
  async getTodoistProjectState(): Promise<null> {
    return null;
  }
  async setTodoistProjectState(): Promise<void> {}
  async getTodoistState(): Promise<null> {
    return null;
  }
  async setTodoistState(): Promise<void> {}
  async removeTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<[]> {
    return [];
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  updateCalls: Array<{ url: string; title: string; body: string }> = [];
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  boardStatusCalls: Array<{ issueUrl: string; optionId: string }> = [];
  addBoardItemCalls: Array<{ projectNodeId: string; issueUrl: string }> = [];
  updated: GithubTaskData | null = null;

  async updateTask(
    url: string,
    input: { title: string; body: string },
  ): Promise<GithubTaskData> {
    this.updateCalls.push({ url, ...input });
    return this.updated ?? issue({ url, title: input.title, body: input.body });
  }
  async setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<GithubTaskData> {
    this.stateCalls.push({ url, state });
    return this.updated ?? issue({ url, state });
  }
  async setBoardStatus(
    _projectNodeId: string,
    _statusFieldId: string,
    issueUrl: string,
    optionId: string,
  ): Promise<void> {
    this.boardStatusCalls.push({ issueUrl, optionId });
  }
  async addBoardItem(projectNodeId: string, issueUrl: string): Promise<void> {
    this.addBoardItemCalls.push({ projectNodeId, issueUrl });
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchProjectDetail(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchTask(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchUnpromotedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }
  async addLabel(): Promise<void> {
    throw new Error('not used in this test');
  }
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
}

const url = 'https://github.com/acme/widgets/issues/42';
const identity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [
    { id: 'PVTSSF_1', name: 'Unshaped' },
    { id: 'PVTSSF_4', name: 'Building' },
    { id: 'PVTSSF_5', name: 'Shipped' },
  ],
};

function task(overrides: Partial<TaskData> = {}): TaskData {
  return {
    url,
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    todoistId: '',
    notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    title: 'Fix the bug',
    body: 'The bug happens on resize.',
    status: 'Building',
    completed: false,
    parent: null,
    labels: ['type: task'],
    updatedAt: '2026-09-18T10:00:00Z',
    ...overrides,
  };
}

function issue(overrides: Partial<GithubTaskData> = {}): GithubTaskData {
  return {
    url,
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the bug',
    body: 'The bug happens on resize.',
    state: 'open',
    updatedAt: '2026-09-18T10:00:00Z',
    labels: ['type: task'],
    ...overrides,
  };
}

function makeAction(syncState: FakeSyncState, port: FakeProjectManagement) {
  return new ApplyTaskToGithubAction(port, syncState);
}

describe('ApplyTaskToGithubAction', () => {
  it('writes the issue body and title when they differ', async () => {
    // Given — a winning vault task whose body and title moved
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);
    const current = task({ title: 'Fix the bug', body: 'Old body.' });
    const winning = task({ title: 'Fix the widget', body: 'New body.' });

    // When — the winning task is rendered onto GitHub
    await action.execute({
      task: winning,
      current,
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the issue is updated with the winning title and body
    expect(port.updateCalls).toEqual([
      { url, title: 'Fix the widget', body: 'New body.' },
    ]);
  });

  it('does not write the issue when the body and title already match', async () => {
    // Given — a winning task identical to the remote
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);
    const current = task();

    // When — the winning task is rendered
    await action.execute({
      task: task(),
      current,
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — no issue write happens
    expect(port.updateCalls).toEqual([]);
  });

  it('closes the issue when the winning task is completed', async () => {
    // Given — a winning task marked completed, the remote still open
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ completed: true, status: 'Shipped' }),
      current: task({ completed: false }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the issue is closed
    expect(port.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('moves the board card only when the lane differs', async () => {
    // Given — a winning task in a different lane than the card
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: 'Shipped' }),
      current: task({ status: 'Building' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the card moves to the winning lane's option
    expect(port.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_5' },
    ]);
  });

  it('adds a missing card and places it in the winning lane', async () => {
    // Given — a tracked issue with no card (the remote lane is empty)
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: 'Building' }),
      current: task({ status: '' }),
      hasCard: false,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the card is added and placed in the winning lane
    expect(port.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: url },
    ]);
    expect(port.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_4' },
    ]);
  });

  it('skips the board for a project with no stored identity', async () => {
    // Given — a board-less project
    const syncState = new FakeSyncState();
    syncState.identity = null;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: 'Shipped' }),
      current: task({ status: 'Building' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — no board write happens
    expect(port.boardStatusCalls).toEqual([]);
    expect(port.addBoardItemCalls).toEqual([]);
  });

  it('keeps the remote title when only the body changed', async () => {
    // Given — a winning task whose body moved but whose title slug is unchanged
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ title: 'fix the bug', body: 'New body.' }),
      current: task({ title: 'Fix the Bug!', body: 'Old body.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the body is pushed with the remote's own title
    expect(port.updateCalls).toEqual([
      { url, title: 'Fix the Bug!', body: 'New body.' },
    ]);
  });

  it('reopens the issue when the winning task is not completed', async () => {
    // Given — a winning task not completed, the remote closed
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ completed: false }),
      current: task({ completed: true }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the issue is reopened
    expect(port.stateCalls).toEqual([{ url, state: 'open' }]);
  });

  it('does not move the card when the lane already matches', async () => {
    // Given — a winning task in the same lane as the card
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: 'Building' }),
      current: task({ status: 'Building' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the card is left alone
    expect(port.boardStatusCalls).toEqual([]);
  });

  it('adds a card without a lane when the winning lane is empty', async () => {
    // Given — a card-less issue whose winning task has no lane
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: '' }),
      current: task({ status: '' }),
      hasCard: false,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the card is added but no lane is written
    expect(port.addBoardItemCalls).toHaveLength(1);
    expect(port.boardStatusCalls).toEqual([]);
  });

  it('refreshes the TaskData record from the write response', async () => {
    // Given — a winning task whose body moved
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const port = new FakeProjectManagement();
    port.updated = issue({
      title: 'Fix the widget',
      body: 'New body.',
      updatedAt: '2026-09-18T12:30:00Z',
    });
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ title: 'Fix the widget', body: 'New body.' }),
      current: task({ body: 'Old body.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the record reflects the response's body and updatedAt
    expect(syncState.setCalls).toEqual([
      taskRecord({
        url,
        remoteId: 42,
        nodeId: 'I_kwDOAAAA42',
        notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
        body: hash('New body.'),
        updatedAt: '2026-09-18T12:30:00Z',
        status: 'Building',
        title: 'Fix the widget',
        labels: ['type: task'],
      }),
    ]);
  });
});
