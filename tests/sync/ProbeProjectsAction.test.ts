import { describe, expect, it } from 'vitest';
import { ProbeProjectsAction } from '../../src/sync/ProbeProjectsAction.js';
import { ProjectState } from '../../src/core/data/ProjectState.js';
import type { ProjectSetupPort } from '../../src/core/ports/ProjectSetupPort.js';
import type { ProjectSetupFactoryPort } from '../../src/core/ports/ProjectSetupFactoryPort.js';
import type { ProjectIdentityData } from '../../src/core/ProjectIdentityData.js';
import type { ProjectStateData } from '../../src/core/ProjectStateData.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

class FakeSetup implements ProjectSetupPort {
  probeCalls: string[][] = [];
  states = new Map<string, ProjectState>();

  async probeProjects(
    handles: readonly string[],
  ): Promise<readonly ProjectState[]> {
    this.probeCalls.push([...handles]);
    return handles.flatMap((handle) => {
      const state = this.states.get(handle);
      return state === undefined ? [] : [state];
    });
  }
  async discoverProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
  async readProjectAddressing(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createProjectWithStatus(): Promise<never> {
    throw new Error('not used in this test');
  }
  async adoptProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async listProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
}

function makeAction(
  setup: FakeSetup,
  syncState: FakeSyncState,
): ProbeProjectsAction {
  const setupFactory: ProjectSetupFactoryPort = {
    setupFor: (application) => (application === 'github' ? setup : null),
  };
  return new ProbeProjectsAction(setupFactory, syncState);
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

function state(projectId: string): ProjectState {
  return new ProjectState({
    handle: projectId,
    updatedAt: '2026-09-18T10:00:00Z',
    archived: false,
  });
}

function stateData(projectId: string): ProjectStateData {
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
    const setup = new FakeSetup();
    setup.states.set('PVT_1', state('PVT_1'));
    setup.states.set('PVT_2', state('PVT_2'));
    const action = makeAction(setup, syncState);

    const result = await action.execute([
      { projectName: 'Acme Widgets', connectionSlug: 'github', application: 'github' },
      { projectName: 'Other', connectionSlug: 'github', application: 'github' },
    ]);

    expect(setup.probeCalls).toEqual([['PVT_1', 'PVT_2']]);
    expect([...result.keys()]).toEqual(['Acme Widgets', 'Other']);
    expect(result.get('Acme Widgets')).toEqual(stateData('PVT_1'));
  });

  it('skips a project with no stored identity', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity('PVT_1'));
    const setup = new FakeSetup();
    setup.states.set('PVT_1', state('PVT_1'));
    const action = makeAction(setup, syncState);

    const result = await action.execute([
      { projectName: 'Acme Widgets', connectionSlug: 'github', application: 'github' },
      { projectName: 'Unattached', connectionSlug: 'github', application: 'github' },
    ]);

    expect(setup.probeCalls).toEqual([['PVT_1']]);
    expect([...result.keys()]).toEqual(['Acme Widgets']);
  });

  it('skips a project whose probe state is missing (deleted project)', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Gone', identity('PVT_9'));
    const setup = new FakeSetup();
    const action = makeAction(setup, syncState);

    const result = await action.execute([
      { projectName: 'Gone', connectionSlug: 'github', application: 'github' },
    ]);

    expect(result.size).toBe(0);
  });

  it('returns an empty map when no project has an identity', async () => {
    const syncState = new FakeSyncState();
    const setup = new FakeSetup();
    const action = makeAction(setup, syncState);

    const result = await action.execute([
      { projectName: 'Acme Widgets', connectionSlug: 'github', application: 'github' },
      { projectName: 'Other', connectionSlug: 'github', application: 'github' },
    ]);

    expect(result.size).toBe(0);
    expect(setup.probeCalls).toEqual([[]]);
  });
});
