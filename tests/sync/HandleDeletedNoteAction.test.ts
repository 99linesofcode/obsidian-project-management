import { describe, expect, it } from 'vitest';
import { HandleDeletedNoteAction } from '../../src/sync/HandleDeletedNoteAction.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

class FakeProjectManagement implements ProjectManagementPort {
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  deleteCardCalls: Array<{ projectNodeId: string; issueUrl: string }> = [];

  async deleteCard(projectNodeId: string, issueUrl: string): Promise<void> {
    this.deleteCardCalls.push({ projectNodeId, issueUrl });
  }
  async setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<GithubTaskData> {
    this.stateCalls.push({ url, state });
    return {
      url,
      nodeId: 'I_kwDOAAAA42',
      title: 'Fix the Bug!',
      body: '',
      state,
      createdAt: null,
      lastEditedAt: null,
      updatedAt: '2026-09-18T12:30:00Z',
      labels: ['type: task'],
      parentUrl: null,
    };
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
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
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
const notePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
const projectName = 'Acme Widgets';

const identity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [
    { id: 'PVTSSF_4', name: 'Building' },
    { id: 'PVTSSF_5', name: 'Shipped' },
  ],
};

function seed(syncState: FakeSyncState, lane = 'Building'): void {
  syncState.identities.set(projectName, identity);
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: {
      handle: url,
      base: taskData({ id: 'uuid-42', notePath, status: lane }),
    },
  });
}

function makeAction(
  syncState: FakeSyncState,
  projectManagement: FakeProjectManagement,
) {
  return new HandleDeletedNoteAction(syncState, projectManagement, 'Shipped');
}

describe('DEL-1 — a deleted note closes its issue and drops its record', () => {
  it('deletes the card, closes the issue and removes the record', async () => {
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seed(syncState);
    const action = makeAction(syncState, projectManagement);

    await action.execute({ notePath, projectName, connectionSlug: 'github' });

    expect(projectManagement.deleteCardCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: url },
    ]);
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
    expect(syncState.removed).toEqual(['uuid-42']);
    expect(await syncState.findByNotePath(notePath)).toBeNull();
  });

  it('skips the close when the record already sits in the done lane', async () => {
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    seed(syncState, 'Shipped');
    const action = makeAction(syncState, projectManagement);

    await action.execute({ notePath, projectName, connectionSlug: 'github' });

    expect(projectManagement.deleteCardCalls).toHaveLength(1);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(syncState.removed).toEqual(['uuid-42']);
  });

  it('does nothing for an untracked note', async () => {
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    const action = makeAction(syncState, projectManagement);

    await action.execute({
      notePath: 'Projecten/Acme Widgets/taken/99-untracked.md',
      projectName,
      connectionSlug: 'github',
    });

    expect(projectManagement.deleteCardCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });
});
