import { describe, expect, it } from 'vitest';
import { EnsureProjectBoardAction } from '../../../../src/core/application/actions/EnsureProjectBoardAction.js';
import { ResolveProjectBoardAction } from '../../../../src/core/application/actions/ResolveProjectBoardAction.js';
import { ProjectAddressing } from '../../../../src/core/port/data/ProjectAddressing.js';
import { ProjectCandidate } from '../../../../src/core/port/data/ProjectCandidate.js';
import { ProjectDiscovery } from '../../../../src/core/port/data/ProjectDiscovery.js';
import { ProjectSummary } from '../../../../src/core/port/data/ProjectSummary.js';
import type { ProjectSetupSurface } from '../../../../src/core/port/MirrorPort.js';
import type { ProjectIdentityDataTransferObject } from '../../../../src/core/port/data/ProjectIdentityDataTransferObject.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

class FakeSetup implements ProjectSetupSurface {
  discovery: ProjectDiscovery = new ProjectDiscovery({
    targetHandle: 'R_kgDOAAAA',
    projects: [],
  });
  candidates: ProjectCandidate[] = [];
  createCalls: Array<{
    target: string;
    name: string;
    statusOptions: string[];
  }> = [];
  adoptCalls: Array<{ target: string; project: ProjectSummary }> = [];
  addressings = new Map<string, ProjectAddressing>();
  created = new ProjectAddressing({
    projectHandle: 'PVT_created',
    statusFieldHandle: 'PVTF_created',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  });

  async discoverProjects(): Promise<ProjectDiscovery> {
    return this.discovery;
  }
  async readProjectAddressing(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createProjectWithStatus(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing> {
    this.createCalls.push({ target, name, statusOptions: [...statusOptions] });
    return this.created;
  }
  async adoptProject(
    target: string,
    project: ProjectSummary,
  ): Promise<ProjectAddressing> {
    this.adoptCalls.push({ target, project });
    return (
      this.addressings.get(project.handle) ??
      new ProjectAddressing({
        projectHandle: project.handle,
        statusFieldHandle: '',
        statusOptions: [],
      })
    );
  }
  async listProjects(): Promise<readonly ProjectCandidate[]> {
    return this.candidates;
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

function project(name: string): ProjectSummary {
  return new ProjectSummary({ handle: `PVT_${name}`, name });
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
  const action = new EnsureProjectBoardAction(
    syncState,
    statusOptions,
    new ResolveProjectBoardAction(),
  );
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
    const named = project('widgets');
    h.setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [project('Roadmap'), named],
    });
    h.setup.addressings.set(
      named.handle,
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
