import { describe, expect, it } from 'vitest';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';

// Fakes at the ports: hold the stored identity and record the board status
// writes the action asks for, so the action's own behaviour (identity lookup
// → option mapping → board write, or silent skip) is what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  boardStatusCalls: Array<{
    projectNodeId: string;
    statusFieldId: string;
    issueUrl: string;
    statusOptionId: string;
  }> = [];

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchTrackedIssues(): Promise<TaskData[]> {
    return [];
  }
  async fetchTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async setTaskState(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
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
}

class FakeSyncState implements SyncStatePort {
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }

  async setLastProjectUpdate(): Promise<void> {}
  async getArchiveBaseline(): Promise<null> {
    return null;
  }
  async getWatchState(): Promise<{
    etag: string | null;
    cursor: string | null;
  }> {
    return { etag: null, cursor: null };
  }

  async setWatchState(): Promise<void> {}

  async setArchiveBaseline(): Promise<void> {}
  identity: ProjectIdentityData | null = null;

  async get(): Promise<null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
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

describe('BoardStatusAction', () => {
  it('sets the board status to the done option for a done note', async () => {
    // Given — a project with a stored identity and a done note
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const action = new BoardStatusAction(syncState, projectManagement);

    // When — the done status is mirrored to the board
    await action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Shipped',
    });

    // Then — the board Status is set to the done option
    expect(projectManagement.boardStatusCalls).toEqual([
      {
        projectNodeId: 'PVT_123',
        statusFieldId: 'PVTF_456',
        issueUrl: url,
        statusOptionId: 'PVTSSF_5',
      },
    ]);
  });

  it('sets the board status to the first option for an open note', async () => {
    // Given — a project with a stored identity and an open note
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const action = new BoardStatusAction(syncState, projectManagement);

    // When — the open status is mirrored to the board
    await action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Unshaped',
    });

    // Then — the board Status is set to the first (default) option
    expect(projectManagement.boardStatusCalls).toEqual([
      {
        projectNodeId: 'PVT_123',
        statusFieldId: 'PVTF_456',
        issueUrl: url,
        statusOptionId: 'PVTSSF_1',
      },
    ]);
  });

  it('skips silently when the project has no stored identity', async () => {
    // Given — a project with no stored identity (board-less)
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    syncState.identity = null;
    const action = new BoardStatusAction(syncState, projectManagement);

    // When — a status is mirrored to the board
    await action.execute({
      projectName: 'Acme Widgets',
      url,
      statusName: 'Shipped',
    });

    // Then — nothing is written to the board
    expect(projectManagement.boardStatusCalls).toEqual([]);
  });
});
