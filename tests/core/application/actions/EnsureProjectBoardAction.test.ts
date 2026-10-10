import { describe, expect, it } from 'vitest';
import { EnsureProjectBoardAction } from '../../../../src/core/application/actions/EnsureProjectBoardAction.js';
import { ProjectAddressing } from '../../../../src/core/application/data/ProjectAddressing.js';
import { ProjectCandidate } from '../../../../src/core/application/data/ProjectCandidate.js';
import { ProjectDiscovery } from '../../../../src/core/application/data/ProjectDiscovery.js';
import { ProjectSummary } from '../../../../src/core/application/data/ProjectSummary.js';
import type { ProjectSetupPort } from '../../../../src/core/port/ProjectSetupPort.js';
import type { ProjectIdentityDataTransferObject } from '../../../../src/core/application/data/ProjectIdentityDataTransferObject.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

class FakeSetup implements ProjectSetupPort {
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
    projectHandle: 'PVT_new',
    statusFieldHandle: 'PVTF_new',
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
        statusFieldHandle: 'PVTF_adopted',
        statusOptions: [],
      })
    );
  }
  async listProjects(): Promise<readonly ProjectCandidate[]> {
    return this.candidates;
  }
}

const repoUrl = 'https://github.com/acme/widgets';
const projectName = 'Acme Widgets';
const SLUG = 'github';
const statusOptions = ['Unshaped', 'Shaping', 'Shaped', 'Building', 'Shipped'];

function identity(
  overrides: Partial<ProjectIdentityDataTransferObject> = {},
): ProjectIdentityDataTransferObject {
  return {
    repoUrl: '',
    repoNodeId: '',
    projectNodeId: '',
    statusFieldId: '',
    statusOptions: [],
    ...overrides,
  };
}

function project(name: string): ProjectSummary {
  return new ProjectSummary({ handle: `PVT_${name}`, name });
}

function candidate(name: string, targets: string[] = []): ProjectCandidate {
  return new ProjectCandidate({ project: project(name), targets });
}

function setup(stored?: ProjectIdentityDataTransferObject) {
  const setupPort = new FakeSetup();
  const syncState = new FakeSyncState();
  if (stored !== undefined) {
    syncState.identities.set(projectName, stored);
  }
  const action = new EnsureProjectBoardAction(syncState, statusOptions);
  return { action, setup: setupPort, syncState };
}

describe('PRJ-1 — the board is derived from the repository', () => {
  it('creates, links and gives a Status field when the repo has no board', async () => {
    const h = setup(identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }));

    await h.action.execute({
      projectName,
      connectionSlug: SLUG,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([
      { target: repoUrl, name: 'widgets', statusOptions },
    ]);
    expect(h.setup.adoptCalls).toEqual([]);
    expect(await h.syncState.getIdentity(projectName, SLUG)).toEqual({
      repoUrl,
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_new',
      statusFieldId: 'PVTF_new',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    });
  });

  it('adopts the single board linked to the repo', async () => {
    const h = setup(identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }));
    const linked = project('widgets');
    h.setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [linked],
    });
    h.setup.addressings.set(
      linked.handle,
      new ProjectAddressing({
        projectHandle: 'PVT_widgets',
        statusFieldHandle: 'PVTF_live',
        statusOptions: [{ id: 'PVTSSF_live', name: 'Shipped' }],
      }),
    );

    await h.action.execute({
      projectName,
      connectionSlug: SLUG,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls).toEqual([{ target: repoUrl, project: linked }]);
    expect(await h.syncState.getIdentity(projectName, SLUG)).toEqual({
      repoUrl,
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_widgets',
      statusFieldId: 'PVTF_live',
      statusOptions: [{ id: 'PVTSSF_live', name: 'Shipped' }],
    });
  });

  it('adopts the board titled with the repo name when several are linked', async () => {
    const h = setup(identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }));
    const match = project('widgets');
    h.setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [project('Roadmap'), match],
    });
    h.setup.addressings.set(
      match.handle,
      new ProjectAddressing({
        projectHandle: 'PVT_widgets',
        statusFieldHandle: 'PVTF_live',
        statusOptions: [{ id: 'PVTSSF_live', name: 'Shipped' }],
      }),
    );

    await h.action.execute({
      projectName,
      connectionSlug: SLUG,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls).toEqual([{ target: repoUrl, project: match }]);
    expect(
      (await h.syncState.getIdentity(projectName, SLUG))?.projectNodeId,
    ).toBe('PVT_widgets');
  });

  it('adopts an unlinked same-name viewer board instead of creating a duplicate', async () => {
    const h = setup(identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }));
    const orphan = project('widgets');
    h.setup.candidates = [candidate('widgets')];
    h.setup.addressings.set(
      orphan.handle,
      new ProjectAddressing({
        projectHandle: 'PVT_orphan',
        statusFieldHandle: 'PVTF_orphan',
        statusOptions: [{ id: 'PVTSSF_o', name: 'Shipped' }],
      }),
    );

    await h.action.execute({
      projectName,
      connectionSlug: SLUG,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls).toEqual([{ target: repoUrl, project: orphan }]);
    expect(
      (await h.syncState.getIdentity(projectName, SLUG))?.projectNodeId,
    ).toBe('PVT_orphan');
  });

  it('surfaces a discovery error when several boards match no repo name', async () => {
    const h = setup(identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }));
    h.setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [project('Roadmap'), project('Backlog')],
    });

    await expect(
      h.action.execute({ projectName, connectionSlug: SLUG, setup: h.setup }),
    ).rejects.toThrow(/several boards/);

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls).toEqual([]);
    expect(await h.syncState.getIdentity(projectName, SLUG)).toEqual(
      identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }),
    );
  });

  it('is idempotent: an identity that already has a board is left alone', async () => {
    const h = setup(identity({ repoUrl, projectNodeId: 'PVT_existing' }));

    await h.action.execute({
      projectName,
      connectionSlug: SLUG,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls).toEqual([]);
    expect(
      (await h.syncState.getIdentity(projectName, SLUG))?.projectNodeId,
    ).toBe('PVT_existing');
  });

  it('leaves a repo-less project board-less', async () => {
    const h = setup(identity({ repoUrl: '' }));

    await h.action.execute({
      projectName,
      connectionSlug: SLUG,
      setup: h.setup,
    });

    expect(h.setup.createCalls).toEqual([]);
    expect(h.setup.adoptCalls).toEqual([]);
    expect(await h.syncState.getIdentity(projectName, SLUG)).toEqual(
      identity({ repoUrl: '' }),
    );
  });
});
