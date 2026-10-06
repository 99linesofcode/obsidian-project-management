import { describe, expect, it } from 'vitest';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import { entityRecord, taskData } from '../../helpers/records.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

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

describe('BoardStatusAction', () => {
  it('sets the board status to the done option for a done note', async () => {
    // Given — a project with a stored identity and no record (unknown lane)
    const h = harness();
    h.syncState.identities.set('Acme Widgets', identity);

    // When — the done status is mirrored to the board
    await h.action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Shipped',
    });

    // Then — the board Status is set to the done option
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
    // Given — a project with a stored identity and no record
    const h = harness();
    h.syncState.identities.set('Acme Widgets', identity);

    // When — the open status is mirrored to the board
    await h.action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Unshaped',
    });

    // Then — the board Status is set to the first (default) option
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
    // Given — a record whose github base lane is the one being mirrored
    const h = harness();
    h.syncState.identities.set('Acme Widgets', identity);
    h.syncState.seed(entityRecord({ id: 'uuid-42' }), {
      github: {
        handle: url,
        base: taskData({ id: 'uuid-42', status: 'Building' }),
      },
    });

    // When — the same lane is mirrored
    await h.action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Building',
    });

    // Then — the card is already in step, so nothing is written
    expect(h.projectManagement.boardStatusCalls).toEqual([]);
  });

  it('skips silently when the project has no stored identity', async () => {
    // Given — a project with no stored identity (board-less)
    const h = harness();

    // When — a status is mirrored to the board
    await h.action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Shipped',
    });

    // Then — nothing is written to the board
    expect(h.projectManagement.boardStatusCalls).toEqual([]);
  });
});
