import { describe, expect, it } from 'vitest';
import { DiscoverProjectsAction } from '../../../src/Domain/Actions/DiscoverProjectsAction.js';
import { AttachProjectAction } from '../../../src/Domain/Actions/AttachProjectAction.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the vault returns the project notes discovery finds,
// and the project management port resolves identities. The discovery action's
// own behaviour (which notes become projects, which errors are collected) is
// what's under test, against the real AttachProjectAction.
class FakeVault implements VaultPort {
  notes: ProjectNoteData[] = [];

  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return this.notes;
  }

  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
}

class FakePort implements ProjectManagementPort {
  result: ProjectIdentityData | null = null;

  async fetchProjectIdentity(): Promise<ProjectIdentityData | null> {
    return this.result;
  }

  async fetchChangedTasks(): Promise<never> {
    throw new Error('not used in this test');
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
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setBoardStatus(): Promise<never> {
    throw new Error('not used in this test');
  }
  async addBoardItem(): Promise<never> {
    throw new Error('not used in this test');
  }

  async fetchUnpromotedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }

  async addLabel(): Promise<void> {
    throw new Error('not used in this test');
  }

  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const identity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [{ id: 'PVTSSF_1', name: 'Todo' }],
};

function githubNote(overrides: Partial<ProjectNoteData> = {}): ProjectNoteData {
  return {
    path: 'Projecten/Acme Widgets/_home.md',
    projectName: 'Acme Widgets',
    pm: 'github',
    url: 'https://github.com/acme/widgets',
    board: 'https://github.com/orgs/acme/projects/1',
    ...overrides,
  };
}

function makeAction(port: FakePort, vault: FakeVault): DiscoverProjectsAction {
  return new DiscoverProjectsAction(vault, new AttachProjectAction(port));
}

describe('DiscoverProjectsAction', () => {
  it('discovers github project notes with their project name and identity', async () => {
    // Given — a vault with one github project note and a port that resolves it
    const vault = new FakeVault();
    vault.notes = [githubNote()];
    const port = new FakePort();
    port.result = identity;
    const action = makeAction(port, vault);

    // When — discovery runs
    const result = await action.execute();

    // Then — the project is discovered with its name and resolved identity
    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', identity },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('skips project notes for providers this plugin does not handle', async () => {
    // Given — a vault with a non-github project note
    const vault = new FakeVault();
    vault.notes = [
      githubNote({ pm: 'linear', board: 'https://linear.app/acme/project/1' }),
    ];
    const port = new FakePort();
    const action = makeAction(port, vault);

    // When — discovery runs
    const result = await action.execute();

    // Then — nothing is discovered and no error is recorded
    expect(result.projects).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('collects the error for a github note missing its board and still discovers the rest', async () => {
    // Given — a vault with a broken github note (no board) and a valid one
    const vault = new FakeVault();
    vault.notes = [
      githubNote({
        path: 'Projecten/Broken/_home.md',
        projectName: 'Broken',
        board: '',
      }),
      githubNote(),
    ];
    const port = new FakePort();
    port.result = identity;
    const action = makeAction(port, vault);

    // When — discovery runs
    const result = await action.execute();

    // Then — the valid project is still discovered and the broken one's error
    // is collected rather than aborting the whole discovery
    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', identity },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(Error);
  });
});
