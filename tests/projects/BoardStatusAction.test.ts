import { describe, expect, it } from 'vitest';
import { BoardStatusAction } from '../../src/projects/BoardStatusAction.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: hold the stored identity and record the board status
// writes the action asks for, so the action's own behaviour (identity lookup
// → option mapping → board write, or silent skip) is what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  boardStatusCalls: Array<{
    projectNodeId: string;
    statusFieldId: string;
    issueUrl: string;
    statusOptionId: string;
  }> = [];

  async setBoardStatus(
    projectNodeId: string,
    statusFieldId: string,
    issueUrl: string,
    statusOptionId: string,
  ): Promise<void> {
    this.boardStatusCalls.push({
      projectNodeId,
      statusFieldId,
      issueUrl,
      statusOptionId,
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
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
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
  async addBoardItem(): Promise<never> {
    throw new Error('not used in this test');
  }
  async addLabel(): Promise<never> {
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
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
}

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

const url = 'https://github.com/acme/widgets/issues/42';

function harness() {
  const projectManagement = new FakeProjectManagement();
  const syncState = new FakeSyncState();
  const action = new BoardStatusAction(syncState, projectManagement);
  return { action, syncState, projectManagement };
}

describe('LANE-2 — a lane move follows on every surface', () => {
  it('sets the board status to the done option for a done note', async () => {
    const h = harness();
    h.syncState.identities.set('Acme Widgets', identity);

    await h.action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Shipped',
    });

    expect(h.projectManagement.boardStatusCalls).toEqual([
      {
        projectNodeId: 'PVT_123',
        statusFieldId: 'PVTF_456',
        issueUrl: url,
        statusOptionId: 'PVTSSF_5',
      },
    ]);
  });

  it('sets the board status to the first option for an open note', async () => {
    const h = harness();
    h.syncState.identities.set('Acme Widgets', identity);

    await h.action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Unshaped',
    });

    expect(h.projectManagement.boardStatusCalls).toEqual([
      {
        projectNodeId: 'PVT_123',
        statusFieldId: 'PVTF_456',
        issueUrl: url,
        statusOptionId: 'PVTSSF_1',
      },
    ]);
  });

  it('skips the board write when the base record already sits in the lane', async () => {
    const h = harness();
    h.syncState.identities.set('Acme Widgets', identity);
    h.syncState.seed(entityRecord({ id: 'uuid-42' }), {
      github: {
        handle: url,
        base: taskData({ id: 'uuid-42', status: 'Building' }),
      },
    });

    await h.action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Building',
    });

    expect(h.projectManagement.boardStatusCalls).toEqual([]);
  });

  it('skips silently when the project has no stored identity', async () => {
    const h = harness();

    await h.action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Shipped',
    });

    expect(h.projectManagement.boardStatusCalls).toEqual([]);
  });
});
