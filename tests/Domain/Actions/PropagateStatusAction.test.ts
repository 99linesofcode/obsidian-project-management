import { describe, expect, it } from 'vitest';
import { PropagateStatusAction } from '../../../src/Domain/Actions/PropagateStatusAction.js';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import { TaskStatus } from '../../../src/Domain/Enums/TaskStatus.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';

// Fakes at the ports: record the state change the action asks for and hold
// the status record in memory, so the action's own behaviour (PATCH state +
// baseline refresh + board mirror) is what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  boardStatusCalls: Array<{ issueUrl: string; statusOptionId: string }> = [];
  updated: TaskData = {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the Bug!',
    body: 'The bug happens when the widget is resized.',
    state: 'closed',
    updatedAt: '2026-09-18T12:30:00Z',
    labels: ['type:task'],
  };

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchChangedTasks(): Promise<TaskData[]> {
    return [];
  }
  async fetchTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async setTaskState(url: string, state: 'open' | 'closed'): Promise<TaskData> {
    this.stateCalls.push({ url, state });
    return this.updated;
  }
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setBoardStatus(
    _projectNodeId: string,
    _statusFieldId: string,
    issueUrl: string,
    statusOptionId: string,
  ): Promise<void> {
    this.boardStatusCalls.push({ issueUrl, statusOptionId });
  }
  async addBoardItem(): Promise<void> {
    throw new Error('not used in this test');
  }

  async fetchUnpromotedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }

  async addLabel(): Promise<void> {
    throw new Error('not used in this test');
  }
}

class FakeSyncState implements SyncStatePort {
  statuses = new Map<string, Status>();
  setCalls: Status[] = [];
  identity: ProjectIdentityData | null = null;

  async get(url: string): Promise<Status | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: Status): Promise<void> {
    this.statuses.set(status.url, status);
    this.setCalls.push(status);
  }
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return [];
  }
  async getLastPoll(): Promise<string | null> {
    return null;
  }
  async setLastPoll(): Promise<void> {}
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
}

const task: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: ['type:task'],
};

const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const projectName = 'Acme Widgets';

function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    url: task.url,
    remoteId: task.remoteId,
    notePath,
    lastSyncedBodyHash: hash(task.body),
    lastSyncedRemoteUpdatedAt: task.updatedAt,
    lastSyncedStatus: TaskStatus.Open,
    lastSyncedTitle: task.title,
    ...overrides,
  };
}

function makeAction(projectManagement: FakeProjectManagement, syncState: FakeSyncState) {
  const boardStatus = new BoardStatusAction(syncState, projectManagement, 'Done');
  return new PropagateStatusAction(projectManagement, syncState, boardStatus);
}

describe('PropagateStatusAction', () => {
  it('closes the issue for a done note and refreshes the baseline', async () => {
    // Given — a synced note whose status the user flipped to done
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = { ...task, state: 'closed', updatedAt: '2026-09-18T12:30:00Z' };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({ url: task.url, status: TaskStatus.Done, notePath, projectName });

    // Then — the issue is closed
    expect(projectManagement.stateCalls).toEqual([{ url: task.url, state: 'closed' }]);
    // And the baseline is refreshed from the response, keeping the other fields
    expect(syncState.setCalls).toEqual([
      {
        url: task.url,
        remoteId: task.remoteId,
        notePath,
        lastSyncedBodyHash: hash(task.body),
        lastSyncedRemoteUpdatedAt: '2026-09-18T12:30:00Z',
        lastSyncedStatus: TaskStatus.Done,
        lastSyncedTitle: task.title,
      },
    ]);
  });

  it('reopens the issue for an open note and refreshes the baseline', async () => {
    // Given — a synced note whose status the user flipped back to open
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = { ...task, state: 'open', updatedAt: '2026-09-18T12:30:00Z' };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus({ lastSyncedStatus: TaskStatus.Done }));
    const action = makeAction(projectManagement, syncState);

    // When — the open status is propagated
    await action.execute({ url: task.url, status: TaskStatus.Open, notePath, projectName });

    // Then — the issue is reopened
    expect(projectManagement.stateCalls).toEqual([{ url: task.url, state: 'open' }]);
    // And the baseline is refreshed from the response
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.lastSyncedStatus).toBe(TaskStatus.Open);
    expect(syncState.setCalls[0]!.lastSyncedRemoteUpdatedAt).toBe('2026-09-18T12:30:00Z');
  });

  it('mirrors the status onto the board when the project has an identity', async () => {
    // Given — a project with a stored identity and a done note
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = { ...task, state: 'closed', updatedAt: '2026-09-18T12:30:00Z' };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    syncState.identity = {
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Todo' },
        { id: 'PVTSSF_3', name: 'Done' },
      ],
    };
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({ url: task.url, status: TaskStatus.Done, notePath, projectName });

    // Then — the board Status is set to the done option
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: task.url, statusOptionId: 'PVTSSF_3' },
    ]);
  });

  it('skips the board mirror when the project has no identity', async () => {
    // Given — a project with no stored identity (board-less)
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = { ...task, state: 'closed', updatedAt: '2026-09-18T12:30:00Z' };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    syncState.identity = null;
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({ url: task.url, status: TaskStatus.Done, notePath, projectName });

    // Then — the board is left untouched
    expect(projectManagement.boardStatusCalls).toEqual([]);
  });
});
