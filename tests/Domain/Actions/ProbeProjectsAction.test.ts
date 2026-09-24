import { describe, expect, it } from 'vitest';
import { ProbeProjectsAction } from '../../../src/Domain/Actions/ProbeProjectsAction.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';

// Fakes at the ports: the sync state holds per-project identities and the
// project management fake records each fleet probe and answers it from a
// canned state map, so the action's identity resolution and re-keying is what's
// under test.
class FakeSyncState implements SyncStatePort {
  identities = new Map<string, ProjectIdentityData>();

  async get(): Promise<Status | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return [];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(projectName: string): Promise<ProjectIdentityData | null> {
    return this.identities.get(projectName) ?? null;
  }
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }
  async setLastProjectUpdate(): Promise<void> {}
}

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
  async fetchTrackedIssues(): Promise<TaskData[]> {
    return [];
  }
  async fetchUnpromotedIssues(): Promise<TaskData[]> {
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
  async promoteCard(): Promise<never> {
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

describe('ProbeProjectsAction', () => {
  it('probes every project with an identity in one query, keyed by name', async () => {
    // Given — two projects with stored identities and a state for each
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity('PVT_1'));
    syncState.identities.set('Other', identity('PVT_2'));
    const projectManagement = new FakeProjectManagement();
    projectManagement.states.set('PVT_1', state('PVT_1'));
    projectManagement.states.set('PVT_2', state('PVT_2'));
    const action = new ProbeProjectsAction(projectManagement, syncState);

    // When — the projects are probed
    const result = await action.execute(['Acme Widgets', 'Other']);

    // Then — one probe carries both node ids
    expect(projectManagement.probeCalls).toEqual([['PVT_1', 'PVT_2']]);
    // And the result is keyed by project name
    expect([...result.keys()]).toEqual(['Acme Widgets', 'Other']);
    expect(result.get('Acme Widgets')).toEqual(state('PVT_1'));
  });

  it('skips a project with no stored identity', async () => {
    // Given — one project with an identity and one without
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity('PVT_1'));
    const projectManagement = new FakeProjectManagement();
    projectManagement.states.set('PVT_1', state('PVT_1'));
    const action = new ProbeProjectsAction(projectManagement, syncState);

    // When — both projects are probed
    const result = await action.execute(['Acme Widgets', 'Unattached']);

    // Then — only the attached project is probed and surfaced
    expect(projectManagement.probeCalls).toEqual([['PVT_1']]);
    expect([...result.keys()]).toEqual(['Acme Widgets']);
  });

  it('skips a project whose probe state is missing (deleted project)', async () => {
    // Given — an identity whose project no longer resolves remotely
    const syncState = new FakeSyncState();
    syncState.identities.set('Gone', identity('PVT_9'));
    const projectManagement = new FakeProjectManagement();
    const action = new ProbeProjectsAction(projectManagement, syncState);

    // When — the project is probed
    const result = await action.execute(['Gone']);

    // Then — it is dropped rather than surfaced with a missing state
    expect(result.size).toBe(0);
  });

  it('returns an empty map when no project has an identity', async () => {
    // Given — no stored identities
    const syncState = new FakeSyncState();
    const projectManagement = new FakeProjectManagement();
    const action = new ProbeProjectsAction(projectManagement, syncState);

    // When — the projects are probed
    const result = await action.execute(['Acme Widgets', 'Other']);

    // Then — nothing is surfaced and the probe carries no ids
    expect(result.size).toBe(0);
    expect(projectManagement.probeCalls).toEqual([[]]);
  });
});
