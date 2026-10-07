import { describe, expect, it } from 'vitest';
import { ProbeProjectsAction } from '../../src/sync/ProbeProjectsAction.js';
import type { BoardItemData } from '../../src/shared/BoardItemData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectStateData } from '../../src/shared/ProjectStateData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: the sync state holds per-project identities and the
// project management fake records each fleet probe and answers it from a
// canned state map, so the action's identity resolution and re-keying is what's
// under test.
class FakeProjectManagement implements ProjectManagementPort {
  probeCalls: string[][] = [];
  states = new Map<string, ProjectStateData>();

  async fetchProjectStates(
    projectNodeIds: string[],
  ): Promise<Map<string, ProjectStateData>> {
    this.probeCalls.push(projectNodeIds);
    const result = new Map<string, ProjectStateData>();
    for (const id of projectNodeIds) {
      const state = this.states.get(id);
      if (state) {
        result.set(id, state);
      }
    }
    return result;
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
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchUnpromotedIssues(): Promise<GithubTaskData[]> {
    return [];
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
  async fetchBoardItems(): Promise<BoardItemData[]> {
    return [];
  }
  async setBoardStatus(): Promise<void> {}
  async addBoardItem(): Promise<void> {}
  async addLabel(): Promise<void> {}
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

function identity(projectNodeId: string): ProjectIdentityData {
  return {
    repoUrl: 'https://github.com/acme/widgets',
    repoNodeId: 'R_kgDOAAAA',
    projectNodeId,
    statusFieldId: 'PVTF_456',
    statusOptions: [],
  };
}

function state(projectId: string): ProjectStateData {
  return {
    projectId,
    updatedAt: '2026-09-18T10:00:00Z',
    closed: false,
  };
}

describe('PRB-1 — a quiet board is not fetched', () => {
  it('probes every project with an identity in one query, keyed by name', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity('PVT_1'));
    syncState.identities.set('Other', identity('PVT_2'));
    const projectManagement = new FakeProjectManagement();
    projectManagement.states.set('PVT_1', state('PVT_1'));
    projectManagement.states.set('PVT_2', state('PVT_2'));
    const action = new ProbeProjectsAction(projectManagement, syncState);

    const result = await action.execute([{ projectName: 'Acme Widgets', connectionSlug: 'github' }, { projectName: 'Other', connectionSlug: 'github' }]);

    expect(projectManagement.probeCalls).toEqual([['PVT_1', 'PVT_2']]);
    expect([...result.keys()]).toEqual(['Acme Widgets', 'Other']);
    expect(result.get('Acme Widgets')).toEqual(state('PVT_1'));
  });

  it('skips a project with no stored identity', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity('PVT_1'));
    const projectManagement = new FakeProjectManagement();
    projectManagement.states.set('PVT_1', state('PVT_1'));
    const action = new ProbeProjectsAction(projectManagement, syncState);

    const result = await action.execute([{ projectName: 'Acme Widgets', connectionSlug: 'github' }, { projectName: 'Unattached', connectionSlug: 'github' }]);

    expect(projectManagement.probeCalls).toEqual([['PVT_1']]);
    expect([...result.keys()]).toEqual(['Acme Widgets']);
  });

  it('skips a project whose probe state is missing (deleted project)', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Gone', identity('PVT_9'));
    const projectManagement = new FakeProjectManagement();
    const action = new ProbeProjectsAction(projectManagement, syncState);

    const result = await action.execute([{ projectName: 'Gone', connectionSlug: 'github' }]);

    expect(result.size).toBe(0);
  });

  it('returns an empty map when no project has an identity', async () => {
    const syncState = new FakeSyncState();
    const projectManagement = new FakeProjectManagement();
    const action = new ProbeProjectsAction(projectManagement, syncState);

    const result = await action.execute([{ projectName: 'Acme Widgets', connectionSlug: 'github' }, { projectName: 'Other', connectionSlug: 'github' }]);

    expect(result.size).toBe(0);
    expect(projectManagement.probeCalls).toEqual([[]]);
  });
});
