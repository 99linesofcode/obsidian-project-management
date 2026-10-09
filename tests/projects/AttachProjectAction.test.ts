import { describe, expect, it } from 'vitest';
import { AttachProjectAction } from '../../src/projects/AttachProjectAction.js';
import { ProjectAddressing } from '../../src/core/data/ProjectAddressing.js';
import { ProjectDiscovery } from '../../src/core/data/ProjectDiscovery.js';
import { ProjectSummary } from '../../src/core/data/ProjectSummary.js';
import type { ProjectSetupPort } from '../../src/core/ports/ProjectSetupPort.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';

class FakeSetup implements ProjectSetupPort {
  discovery: ProjectDiscovery = new ProjectDiscovery({
    targetHandle: 'R_kgDOAAAA',
    projects: [],
  });
  addressings = new Map<string, ProjectAddressing>();
  addressingCalls: ProjectSummary[] = [];

  async discoverProjects(): Promise<ProjectDiscovery> {
    return this.discovery;
  }
  async readProjectAddressing(
    project: ProjectSummary,
  ): Promise<ProjectAddressing | null> {
    this.addressingCalls.push(project);
    return this.addressings.get(project.handle) ?? null;
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
  async probeProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const repoUrl = 'https://github.com/acme/widgets';

function project(name: string): ProjectSummary {
  return new ProjectSummary({ handle: `PVT_${name}`, name });
}

function addressing(): ProjectAddressing {
  return new ProjectAddressing({
    projectHandle: 'PVT_123',
    statusFieldHandle: 'PVTF_456',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  });
}

const identity: ProjectIdentityData = {
  repoUrl,
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
};

describe('ATT-1 — attach resolves the repo and derives the board', () => {
  it('adopts the single board linked to the repo', async () => {
    const setup = new FakeSetup();
    const linked = project('widgets');
    setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [linked],
    });
    setup.addressings.set(linked.handle, addressing());
    const action = new AttachProjectAction();

    const result = await action.execute({ repoUrl, setup });

    expect(setup.addressingCalls).toEqual([linked]);
    expect(result).toEqual(identity);
  });

  it('resolves the repo alone when it has no board yet', async () => {
    const setup = new FakeSetup();
    const action = new AttachProjectAction();

    const result = await action.execute({ repoUrl, setup });

    expect(result).toEqual({
      repoUrl,
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: '',
      statusFieldId: '',
      statusOptions: [],
    });
    expect(setup.addressingCalls).toEqual([]);
  });

  it('adopts the board titled with the repo name when several are linked', async () => {
    const setup = new FakeSetup();
    const match = project('widgets');
    setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [project('Roadmap'), match],
    });
    setup.addressings.set(match.handle, addressing());
    const action = new AttachProjectAction();

    const result = await action.execute({ repoUrl, setup });

    expect(setup.addressingCalls).toEqual([match]);
    expect(result).toEqual(identity);
  });

  it('surfaces a discovery error when several boards match no repo name', async () => {
    const setup = new FakeSetup();
    setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [project('Roadmap'), project('Backlog')],
    });
    const action = new AttachProjectAction();

    await expect(action.execute({ repoUrl, setup })).rejects.toThrow(
      /several boards/,
    );
    expect(setup.addressingCalls).toEqual([]);
  });

  it('throws a domain error when a github connection is missing its repo url', async () => {
    const setup = new FakeSetup();
    const action = new AttachProjectAction();

    await expect(action.execute({ repoUrl: '', setup })).rejects.toThrow(
      /repoUrl/,
    );
    expect(setup.addressingCalls).toEqual([]);
  });
});
