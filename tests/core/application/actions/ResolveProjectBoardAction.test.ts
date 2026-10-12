import { describe, expect, it } from 'vitest';
import { ResolveProjectBoardAction } from '../../../../src/core/application/actions/ResolveProjectBoardAction.js';
import { ProjectDiscovery } from '../../../../src/core/port/data/ProjectDiscovery.js';
import { ProjectSummary } from '../../../../src/core/port/data/ProjectSummary.js';
import type { ProjectSetupSurface } from '../../../../src/core/port/MirrorPort.js';

class FakeSetup implements ProjectSetupSurface {
  discovery: ProjectDiscovery = new ProjectDiscovery({
    targetHandle: 'R_kgDOAAAA',
    projects: [],
  });

  async discoverProjects(): Promise<ProjectDiscovery> {
    return this.discovery;
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

const repoUrl = 'https://github.com/acme/widgets';

function project(name: string): ProjectSummary {
  return new ProjectSummary({ handle: `PVT_${name}`, name });
}

describe('PRJ-1 — the board is derived from the repository', () => {
  it('decides to create when the repo carries no board', async () => {
    const setup = new FakeSetup();

    const resolved = await new ResolveProjectBoardAction().execute({
      target: repoUrl,
      setup,
    });

    expect(resolved).toEqual({
      kind: 'create',
      discovery: setup.discovery,
      boardTitle: 'widgets',
    });
  });

  it('adopts the single board linked to the repo', async () => {
    const setup = new FakeSetup();
    const linked = project('widgets');
    setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [linked],
    });

    const resolved = await new ResolveProjectBoardAction().execute({
      target: repoUrl,
      setup,
    });

    expect(resolved).toEqual({
      kind: 'adopt',
      discovery: setup.discovery,
      board: linked,
    });
  });

  it('adopts the board titled with the repo name when several are linked', async () => {
    const setup = new FakeSetup();
    const match = project('widgets');
    setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [project('Roadmap'), match],
    });

    const resolved = await new ResolveProjectBoardAction().execute({
      target: repoUrl,
      setup,
    });

    expect(resolved).toEqual({
      kind: 'adopt',
      discovery: setup.discovery,
      board: match,
    });
  });

  it('raises when several boards match no repo name', async () => {
    const setup = new FakeSetup();
    setup.discovery = new ProjectDiscovery({
      targetHandle: 'R_kgDOAAAA',
      projects: [project('Roadmap'), project('Backlog')],
    });

    await expect(
      new ResolveProjectBoardAction().execute({ target: repoUrl, setup }),
    ).rejects.toThrow(/several boards/);
  });
});
