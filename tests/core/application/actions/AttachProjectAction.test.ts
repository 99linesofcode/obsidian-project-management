import { describe, expect, it } from 'vitest';
import { AttachProjectAction } from '../../../../src/core/application/actions/AttachProjectAction.js';
import { ProjectAddressing } from '../../../../src/core/application/data/ProjectAddressing.js';
import { ProjectDiscovery } from '../../../../src/core/application/data/ProjectDiscovery.js';
import { ProjectSummary } from '../../../../src/core/application/data/ProjectSummary.js';
import type { ProjectSetupPort } from '../../../../src/core/port/ProjectSetupPort.js';
import type { ProjectIdentityDataTransferObject } from '../../../../src/core/application/data/ProjectIdentityDataTransferObject.js';

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

const identity: ProjectIdentityDataTransferObject = {
  target: repoUrl,
  targetHandle: 'R_kgDOAAAA',
  projectHandle: 'PVT_123',
  statusFieldHandle: 'PVTF_456',
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

    const result = await action.execute({ target: repoUrl, setup });

    expect(setup.addressingCalls).toEqual([linked]);
    expect(result).toEqual(identity);
  });

  it('resolves the repo alone when it has no board yet', async () => {
    const setup = new FakeSetup();
    const action = new AttachProjectAction();

    const result = await action.execute({ target: repoUrl, setup });

    expect(result).toEqual({
      target: repoUrl,
      targetHandle: 'R_kgDOAAAA',
      projectHandle: '',
      statusFieldHandle: '',
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

    const result = await action.execute({ target: repoUrl, setup });

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

    await expect(action.execute({ target: repoUrl, setup })).rejects.toThrow(
      /several boards/,
    );
    expect(setup.addressingCalls).toEqual([]);
  });

  it('throws a domain error when a connection is missing its target', async () => {
    const setup = new FakeSetup();
    const action = new AttachProjectAction();

    await expect(action.execute({ target: '', setup })).rejects.toThrow(
      /target/,
    );
    expect(setup.addressingCalls).toEqual([]);
  });
});
