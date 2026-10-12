import { describe, expect, it } from 'vitest';
import { EnsureProjectBoardAction } from '../../../../src/core/application/actions/EnsureProjectBoardAction.js';
import { ProjectAddressing } from '../../../../src/core/port/data/ProjectAddressing.js';
import type { ProjectSetupSurface } from '../../../../src/core/port/MirrorPort.js';
import type { ProjectIdentityDataTransferObject } from '../../../../src/core/port/data/ProjectIdentityDataTransferObject.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

class FakeSetup implements ProjectSetupSurface {
  existing = new Map<string, ProjectAddressing>();
  createCalls: Array<{
    target: string;
    name: string;
    statusOptions: string[];
  }> = [];
  adoptCalls: Array<{ target: string; name: string }> = [];
  created = new ProjectAddressing({
    projectHandle: 'PVT_created',
    statusFieldHandle: 'PVTF_created',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  });

  async resolveOrCreateProject(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing> {
    const found = this.existing.get(name);
    if (found !== undefined) {
      this.adoptCalls.push({ target, name });
      return found;
    }
    this.createCalls.push({ target, name, statusOptions: [...statusOptions] });
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

describe('ORG-3 — a declared connection resolves-or-creates its remote project', () => {
  it('creates the project and records its addressing when the target carries none', async () => {
    const h = harness(
      'Acme Widgets',
      identity({ target: repoUrl, targetHandle: 'R_kgDOAAAA' }),
    );

    await h.action.execute({
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toHaveLength(1);
    const recorded = await h.syncState.getIdentity('Acme Widgets', SLUG);
    expect(recorded?.projectHandle).not.toBe('');
    expect(recorded?.statusFieldHandle).not.toBe('');
  });

  it('records the addressing of the project named for the vault project', async () => {
    const h = harness(
      'widgets',
      identity({ target: repoUrl, targetHandle: 'R_kgDOAAAA' }),
    );
    h.setup.existing.set(
      'widgets',
      new ProjectAddressing({
        projectHandle: 'PVT_widgets',
        statusFieldHandle: 'PVTF_live',
        statusOptions: [{ id: 'PVTSSF_live', name: 'Shipped' }],
      }),
    );

    await h.action.execute({
      projectName: 'widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls).toHaveLength(1);
    const recorded = await h.syncState.getIdentity('widgets', SLUG);
    expect(recorded?.projectHandle).toBe('PVT_widgets');
    expect(recorded?.statusFieldHandle).toBe('PVTF_live');
  });

  it('creates nothing on a second run once the addressing is recorded', async () => {
    const h = harness(
      'Acme Widgets',
      identity({ target: repoUrl, targetHandle: 'R_kgDOAAAA' }),
    );

    await h.action.execute({
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });
    await h.action.execute({
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toHaveLength(1);
  });
});

describe('I14 — a project that already has an addressing is left alone', () => {
  it('leaves a recorded addressing untouched', async () => {
    const existing = identity({
      target: repoUrl,
      projectHandle: 'PVT_existing',
      statusFieldHandle: 'PVTF_existing',
    });
    const h = harness('Acme Widgets', existing);

    await h.action.execute({
      projectName: 'Acme Widgets',
      connectionSlug: SLUG,
      target: repoUrl,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls).toEqual([]);
    expect(await h.syncState.getIdentity('Acme Widgets', SLUG)).toEqual(
      existing,
    );
  });
});
