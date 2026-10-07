import { describe, expect, it } from 'vitest';
import { PropagateStatusAction } from '../../src/tasks/PropagateStatusAction.js';
import { BoardStatusAction } from '../../src/projects/BoardStatusAction.js';
import type { BoardStatusData } from '../../src/shared/BoardStatusData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

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
  async setBoardStatus(status: BoardStatusData): Promise<void> {
    this.boardStatusCalls.push({
      issueUrl: status.issueUrl,
      statusOptionId: status.statusOptionId,
    });
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
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
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
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchRepoBoards(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createBoardWithStatusField(): Promise<never> {
    throw new Error('not used in this test');
  }
  async listRepoLabels(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createRepoLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
  async adoptBoard(): Promise<never> {
    throw new Error('not used in this test');
  }
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
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the Bug!',
    body: 'The bug happens when the widget is resized.',
    state: 'open',
    createdAt: '2026-09-18T09:00:00Z',
    lastEditedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T10:00:00Z',
    labels: ['type: task'],
    parentUrl: null,
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

describe('LANE-2 — a lane move follows on every surface', () => {
  it('closes the issue for a done note and refreshes the base lane', async () => {
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seedBase(syncState, 'Unshaped');
    const action = makeAction(projectManagement, syncState);

    await action.execute({
      url,
      statusName: 'Shipped',
      notePath,
      projectName,
      connectionSlug: 'github',
    });

    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
    const base = syncState.baseOf('uuid-42', 'github');
    expect(base?.status).toBe('Shipped');
    expect(base?.completedAt).toBe('');
  });

  it('reopens the issue for an open note and refreshes the base lane', async () => {
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seedBase(syncState, 'Shipped');
    const action = makeAction(projectManagement, syncState);

    await action.execute({
      url,
      statusName: 'Unshaped',
      notePath,
      projectName,
      connectionSlug: 'github',
    });

    expect(projectManagement.stateCalls).toEqual([{ url, state: 'open' }]);
    const base = syncState.baseOf('uuid-42', 'github');
    expect(base?.status).toBe('Unshaped');
    expect(base?.completedAt).toBeNull();
  });

  it('skips the issue state write when the lane done-ness is unchanged', async () => {
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seedBase(syncState, 'Unshaped');
    const action = makeAction(projectManagement, syncState);

    await action.execute({
      url,
      statusName: 'Building',
      notePath,
      projectName,
      connectionSlug: 'github',
    });

    expect(projectManagement.stateCalls).toEqual([]);
  });

  it('mirrors the status onto the board when the project has an identity', async () => {
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seedBase(syncState, 'Unshaped');
    const action = makeAction(projectManagement, syncState);

    await action.execute({
      url,
      statusName: 'Shipped',
      notePath,
      projectName,
      connectionSlug: 'github',
    });

    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, statusOptionId: 'PVTSSF_5' },
    ]);
  });

  it('skips the board mirror when the project has no identity', async () => {
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seedBase(syncState, 'Unshaped');
    const action = makeAction(projectManagement, syncState);

    await action.execute({
      url,
      statusName: 'Shipped',
      notePath,
      projectName,
      connectionSlug: 'github',
    });

    expect(projectManagement.boardStatusCalls).toEqual([]);
  });

  it('writes the state for an untracked note with no record', async () => {
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    const action = makeAction(projectManagement, syncState);

    await action.execute({
      url,
      statusName: 'Shipped',
      notePath,
      projectName,
      connectionSlug: 'github',
    });

    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
  });
});
