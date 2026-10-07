import { describe, expect, it } from 'vitest';
import { DiscoverProjectsAction } from '../../src/projects/DiscoverProjectsAction.js';
import { AttachProjectAction } from '../../src/projects/AttachProjectAction.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import type {
  RepoBoardData,
  RepositoryBoardsData,
} from '../../src/shared/RepoBoardData.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';

// Fakes at the ports: the vault returns the project notes discovery finds, and
// the project management port serves a canned board listing. The discovery
// action's own behaviour (which notes become projects, which errors are
// collected) is what's under test, against the real AttachProjectAction.
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

class FakePort implements ProjectManagementPort {
  repoBoardsByUrl = new Map<string, RepositoryBoardsData>();
  defaultRepoBoards: RepositoryBoardsData = {
    repoNodeId: 'R_kgDOAAAA',
    boards: [],
  };
  result: ProjectIdentityData | null = null;

  async fetchRepoBoards(repoUrl: string): Promise<RepositoryBoardsData> {
    return this.repoBoardsByUrl.get(repoUrl) ?? this.defaultRepoBoards;
  }
  async fetchProjectIdentity(): Promise<ProjectIdentityData | null> {
    return this.result;
  }
  async createBoardWithStatusField(): Promise<never> {
    throw new Error('not used in this test');
  }
  async listRepoLabels(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createRepoLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectDetail(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchTrackedIssues(): Promise<never> {
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
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchViewerProjects(): Promise<never> {
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

function board(name: string): RepoBoardData {
  return {
    projectNodeId: `PVT_${name}`,
    name,
    boardUrl: `https://github.com/users/acme/projects/${name.length}`,
  };
}

function githubNote(overrides: Partial<ProjectNoteData> = {}): ProjectNoteData {
  return {
    path: 'Projecten/Acme Widgets/_home.md',
    projectName: 'Acme Widgets',
    archivedAt: null,
    pm: 'github',
    url: repoUrl,
    ...overrides,
  };
}

function makeAction(port: FakePort, vault: FakeVault): DiscoverProjectsAction {
  return new DiscoverProjectsAction(vault, new AttachProjectAction(port));
}

describe('DISC-1 — a project folder is discovered from its home note', () => {
  it('discovers github project notes with their project name and identity', async () => {
    const vault = new FakeVault();
    vault.notes = [githubNote()];
    const port = new FakePort();
    port.repoBoardsByUrl.set(repoUrl, {
      repoNodeId: 'R_kgDOAAAA',
      boards: [board('widgets')],
    });
    port.result = identity;
    const action = makeAction(port, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', identity },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('skips project notes for providers this plugin does not handle', async () => {
    const vault = new FakeVault();
    vault.notes = [githubNote({ pm: 'linear' })];
    const port = new FakePort();
    const action = makeAction(port, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('collects the error for a github note missing its repo url and still discovers the rest', async () => {
    const vault = new FakeVault();
    vault.notes = [
      githubNote({
        path: 'Projecten/Broken/_home.md',
        projectName: 'Broken',
        url: '',
      }),
      githubNote(),
    ];
    const port = new FakePort();
    port.repoBoardsByUrl.set(repoUrl, {
      repoNodeId: 'R_kgDOAAAA',
      boards: [board('widgets')],
    });
    port.result = identity;
    const action = makeAction(port, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', identity },
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
        url: 'https://github.com/acme/ambiguous',
      }),
      githubNote(),
    ];
    const port = new FakePort();
    port.repoBoardsByUrl.set('https://github.com/acme/ambiguous', {
      repoNodeId: 'R_kgDOAAAA',
      boards: [board('Roadmap'), board('Backlog')],
    });
    port.repoBoardsByUrl.set(repoUrl, {
      repoNodeId: 'R_kgDOAAAA',
      boards: [board('widgets')],
    });
    port.result = identity;
    const action = makeAction(port, vault);

    const result = await action.execute();

    expect(result.projects).toEqual([
      { projectName: 'Acme Widgets', identity },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(Error);
  });
});
