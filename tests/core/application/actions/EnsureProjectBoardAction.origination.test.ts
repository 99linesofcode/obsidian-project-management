import { describe, expect, it } from 'vitest';
import { EnsureProjectBoardAction } from '../../../../src/core/application/actions/EnsureProjectBoardAction.js';
import { ProjectAddressing } from '../../../../src/core/port/data/ProjectAddressing.js';
import type { ProjectSetupSurface } from '../../../../src/core/port/MirrorPort.js';
import type { ProjectIdentityDataTransferObject } from '../../../../src/core/port/data/ProjectIdentityDataTransferObject.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

class FakeSetup implements ProjectSetupSurface {
  readonly remote = new Map<string, ProjectAddressing>();
  readonly createCalls: Array<{
    target: string;
    name: string;
    identifier: string;
    statusOptions: string[];
  }> = [];
  readonly adoptCalls: Array<{
    target: string;
    name: string;
    identifier: string;
  }> = [];
  readonly created = new ProjectAddressing({
    projectHandle: 'PVT_created',
    statusFieldHandle: 'PVTF_created',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  });

  async resolveOrCreateProject(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing> {
    const identifier = target === '' ? name : target;
    const call = { target, name, identifier };

    const existing = this.remote.get(identifier);
    if (existing !== undefined) {
      this.adoptCalls.push(call);
      return existing;
    }

    this.createCalls.push({ ...call, statusOptions: [...statusOptions] });
    this.remote.set(identifier, this.created);
    return this.created;
  }
}

const repoUrl = 'https://github.com/acme/widgets';
const SLUG = 'github';
const statusOptions = ['Unshaped', 'Shaping', 'Shaped', 'Building', 'Shipped'];

function identity(
  overrides: Partial<ProjectIdentityDataTransferObject> = {},
): ProjectIdentityDataTransferObject {
  return {
    target: '',
    targetHandle: '',
    projectHandle: '',
    statusFieldHandle: '',
    statusOptions: [],
    ...overrides,
  };
}

function addressing(
  projectHandle: string,
  statusFieldHandle = `${projectHandle}_status`,
): ProjectAddressing {
  return new ProjectAddressing({
    projectHandle,
    statusFieldHandle,
    statusOptions: [],
  });
}

function harness(
  projectName: string,
  stored: ProjectIdentityDataTransferObject,
): {
  action: EnsureProjectBoardAction;
  setup: FakeSetup;
  syncState: FakeSyncState;
} {
  const setup = new FakeSetup();
  const syncState = new FakeSyncState();
  syncState.identities.set(projectName, stored);
  const action = new EnsureProjectBoardAction(syncState, statusOptions);
  return { action, setup, syncState };
}

describe('ORG-2 — an empty target resolves by the vault project name; a non-empty target overrides', () => {
  it('resolves the remote project by the vault project name when the target is empty', async () => {
    const h = harness('Acme Widgets', identity());
    h.setup.remote.set('Acme Widgets', addressing('PVT_by_name'));

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: '',
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls[0]?.identifier).toBe('Acme Widgets');
    const recorded = await h.syncState.getIdentity('Acme Widgets', SLUG);
    expect(recorded?.projectHandle).toBe('PVT_by_name');
  });

  it('resolves by the non-empty target, overriding the vault project name', async () => {
    const h = harness('Acme Widgets', identity());
    h.setup.remote.set(repoUrl, addressing('PVT_by_target'));

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls[0]?.identifier).toBe(repoUrl);
    const recorded = await h.syncState.getIdentity('Acme Widgets', SLUG);
    expect(recorded?.projectHandle).toBe('PVT_by_target');
  });
});

describe('ORG-3 — a declared connection resolves-or-creates its remote project', () => {
  it('creates the remote project when it is absent and records its addressing', async () => {
    const h = harness('Acme Widgets', identity());

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toHaveLength(1);
    const recorded = await h.syncState.getIdentity('Acme Widgets', SLUG);
    expect(recorded?.projectHandle).toBe('PVT_created');
    expect(recorded?.statusFieldHandle).toBe('PVTF_created');
  });

  it('creates nothing on a second run once the addressing is recorded', async () => {
    const h = harness('Acme Widgets', identity());

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });
    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toHaveLength(1);
  });

  it('re-creates the remote project when it is gone, though an addressing is recorded', async () => {
    const h = harness(
      'Acme Widgets',
      identity({
        target: repoUrl,
        projectHandle: 'PVT_gone',
        statusFieldHandle: 'PVTF_gone',
      }),
    );

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toHaveLength(1);
    const recorded = await h.syncState.getIdentity('Acme Widgets', SLUG);
    expect(recorded?.projectHandle).toBe('PVT_created');
  });
});

describe('I14 — a project whose remote project still exists is left alone', () => {
  it('adopts the recorded addressing without creating anything', async () => {
    const existing = identity({
      target: repoUrl,
      projectHandle: 'PVT_existing',
      statusFieldHandle: 'PVTF_existing',
    });
    const h = harness('Acme Widgets', existing);
    h.setup.remote.set(repoUrl, addressing('PVT_existing', 'PVTF_existing'));

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(await h.syncState.getIdentity('Acme Widgets', SLUG)).toEqual(
      existing,
    );
  });
});
