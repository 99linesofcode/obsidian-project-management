import { describe, expect, it } from 'vitest';
import { DiscoverProjectsAction } from '../../src/projects/DiscoverProjectsAction.js';
import { AttachProjectAction } from '../../src/projects/AttachProjectAction.js';
import { ProjectAddressing } from '../../src/core/data/ProjectAddressing.js';
import { ProjectDiscovery } from '../../src/core/data/ProjectDiscovery.js';
import { ProjectSummary } from '../../src/core/data/ProjectSummary.js';
import type { ProjectSetupPort } from '../../src/core/ports/ProjectSetupPort.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';

class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes: ProjectNoteData[] = [];

  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return this.notes;
  }

  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async renameNote(): Promise<void> {}
  async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }
  async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeSetup implements ProjectSetupPort {
  discoveries = new Map<string, ProjectDiscovery>();
  defaultDiscovery = new ProjectDiscovery({
    targetHandle: 'R_kgDOAAAA',
    projects: [],
  });
  addressing = new ProjectAddressing({
    projectHandle: 'PVT_123',
    statusFieldHandle: 'PVTF_456',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  });

  async discoverProjects(target: string): Promise<ProjectDiscovery> {
    return this.discoveries.get(target) ?? this.defaultDiscovery;
  }
  async readProjectAddressing(): Promise<ProjectAddressing> {
    return this.addressing;
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
const identity: ProjectIdentityData = {
  repoUrl,
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
};

function discovery(targetHandle: string, names: string[]): ProjectDiscovery {
  return new ProjectDiscovery({
    targetHandle,
    projects: names.map(
      (name) => new ProjectSummary({ handle: `PVT_${name}`, name }),
    ),
  });
}

function githubNote(overrides: Partial<ProjectNoteData> = {}): ProjectNoteData {
  return {
    path: 'Projecten/Acme Widgets/_home.md',
    projectName: 'Acme Widgets',
    archivedAt: null,
    connections: { github: { tool: 'github', project: repoUrl } },
    connectionErrors: [],
    ...overrides,
  };
}

function makeAction(
  setup: FakeSetup,
  vault: FakeVault,
): DiscoverProjectsAction {
  return new DiscoverProjectsAction(vault, new AttachProjectAction(setup));
}

describe('DISC-1 — a project folder is discovered from its home note', () => {
  it('discovers github project notes with their project name and identity', async () => {
    const vault = new FakeVault();
    vault.notes = [githubNote()];
    const setup = new FakeSetup();
    setup.discoveries.set(repoUrl, discovery('R_kgDOAAAA', ['widgets']));
    const action = makeAction(setup, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', connectionSlug: 'github', identity },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('recognizes a task-manager connection without resolving a code-host identity', async () => {
    const vault = new FakeVault();
    vault.notes = [
      githubNote({
        connections: { todoist: { tool: 'todoist', project: 'P1' } },
      }),
    ];
    const setup = new FakeSetup();
    const action = makeAction(setup, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('discovers a note carrying both a github and a todoist connection', async () => {
    const vault = new FakeVault();
    vault.notes = [
      githubNote({
        connections: {
          github: { tool: 'github', project: repoUrl },
          todoist: { tool: 'todoist', project: 'P1' },
        },
      }),
    ];
    const setup = new FakeSetup();
    setup.discoveries.set(repoUrl, discovery('R_kgDOAAAA', ['widgets']));
    const action = makeAction(setup, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', connectionSlug: 'github', identity },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('surfaces the validation errors a note carried', async () => {
    const vault = new FakeVault();
    const validationError = new Error(
      'connection "work" repeats the "github" tool',
    );
    vault.notes = [githubNote({ connectionErrors: [validationError] })];
    const setup = new FakeSetup();
    setup.discoveries.set(repoUrl, discovery('R_kgDOAAAA', ['widgets']));
    const action = makeAction(setup, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', connectionSlug: 'github', identity },
    ]);
    expect(result.errors).toEqual([validationError]);
  });

  it('collects the error for a github note missing its repo url and still discovers the rest', async () => {
    const vault = new FakeVault();
    vault.notes = [
      githubNote({
        path: 'Projecten/Broken/_home.md',
        projectName: 'Broken',
        connections: { github: { tool: 'github', project: '' } },
      }),
      githubNote(),
    ];
    const setup = new FakeSetup();
    setup.discoveries.set(repoUrl, discovery('R_kgDOAAAA', ['widgets']));
    const action = makeAction(setup, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', connectionSlug: 'github', identity },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(Error);
  });

  it('collects the error for an ambiguous repo and still discovers the rest', async () => {
    const vault = new FakeVault();
    vault.notes = [
      githubNote({
        path: 'Projecten/Ambiguous/_home.md',
        projectName: 'Ambiguous',
        connections: {
          github: {
            tool: 'github',
            project: 'https://github.com/acme/ambiguous',
          },
        },
      }),
      githubNote(),
    ];
    const setup = new FakeSetup();
    setup.discoveries.set(
      'https://github.com/acme/ambiguous',
      discovery('R_kgDOAAAA', ['Roadmap', 'Backlog']),
    );
    setup.discoveries.set(repoUrl, discovery('R_kgDOAAAA', ['widgets']));
    const action = makeAction(setup, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', connectionSlug: 'github', identity },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(Error);
  });
});
