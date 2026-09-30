import { describe, expect, it } from 'vitest';
import { PropagateStatusAction } from '../../../src/Domain/Actions/PropagateStatusAction.js';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import { entityRecord, taskData } from '../../helpers/records.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

// Fakes at the ports: record the state change the action asks for and hold the
// registry record, so the action's own behaviour (PATCH state + base refresh +
// board mirror) is what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  boardStatusCalls: Array<{ issueUrl: string; statusOptionId: string }> = [];

  async setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<GithubTaskData> {
    this.stateCalls.push({ url, state });
    return issue({ url, state });
  }
  async setBoardStatus(
    _projectNodeId: string,
    _statusFieldId: string,
    issueUrl: string,
    statusOptionId: string,
  ): Promise<void> {
    this.boardStatusCalls.push({ issueUrl, statusOptionId });
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
  async updateTask(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
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
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
}

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const projectName = 'Acme Widgets';

const identity = {
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

function issue(overrides: Partial<GithubTaskData> = {}): GithubTaskData {
  return {
    url,
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the Bug!',
    body: 'The bug happens when the widget is resized.',
    state: 'open',
    createdAt: '2026-09-18T09:00:00Z',
    lastEditedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T10:00:00Z',
    labels: ['type: task'],
    ...overrides,
  };
}

function seedBase(syncState: FakeSyncState, lane: string): void {
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: {
      handle: url,
      base: taskData({ id: 'uuid-42', notePath, status: lane }),
    },
  });
}

function makeAction(
  projectManagement: FakeProjectManagement,
  syncState: FakeSyncState,
) {
  const boardStatus = new BoardStatusAction(syncState, projectManagement);
  return new PropagateStatusAction(
    projectManagement,
    syncState,
    boardStatus,
    'Shipped',
  );
}

describe('PropagateStatusAction', () => {
  it('closes the issue for a done note and refreshes the base lane', async () => {
    // Given — a synced note whose status the user flipped to done
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seedBase(syncState, 'Unshaped');
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({
      url,
      statusName: 'Shipped',
      notePath,
      projectName,
    });

    // Then — the issue is closed and the base lane follows
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
    const base = syncState.baseOf('uuid-42', 'github');
    expect(base?.status).toBe('Shipped');
    expect(base?.completedAt).toBe('');
  });

  it('reopens the issue for an open note and refreshes the base lane', async () => {
    // Given — a synced note whose status the user flipped back to open
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seedBase(syncState, 'Shipped');
    const action = makeAction(projectManagement, syncState);

    // When — the open status is propagated
    await action.execute({
      url,
      statusName: 'Unshaped',
      notePath,
      projectName,
    });

    // Then — the issue is reopened and the base lane follows
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'open' }]);
    const base = syncState.baseOf('uuid-42', 'github');
    expect(base?.status).toBe('Unshaped');
    expect(base?.completedAt).toBeNull();
  });

  it('skips the issue state write when the lane done-ness is unchanged', async () => {
    // Given — a record already in an open lane, mirrored to another open lane
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seedBase(syncState, 'Unshaped');
    const action = makeAction(projectManagement, syncState);

    // When — the open lane is propagated
    await action.execute({
      url,
      statusName: 'Building',
      notePath,
      projectName,
    });

    // Then — the issue state is not written (both lanes are open)
    expect(projectManagement.stateCalls).toEqual([]);
  });

  it('mirrors the status onto the board when the project has an identity', async () => {
    // Given — a project with a stored identity and a done note
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seedBase(syncState, 'Unshaped');
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({
      url,
      statusName: 'Shipped',
      notePath,
      projectName,
    });

    // Then — the board card is set to the done option
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, statusOptionId: 'PVTSSF_5' },
    ]);
  });

  it('skips the board mirror when the project has no identity', async () => {
    // Given — a project with no stored identity (board-less)
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seedBase(syncState, 'Unshaped');
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({
      url,
      statusName: 'Shipped',
      notePath,
      projectName,
    });

    // Then — the board is left untouched
    expect(projectManagement.boardStatusCalls).toEqual([]);
  });

  it('writes the state for an untracked note with no record', async () => {
    // Given — no registry record for the issue
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({
      url,
      statusName: 'Shipped',
      notePath,
      projectName,
    });

    // Then — the state is written (no baseline to gate against)
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
  });
});
