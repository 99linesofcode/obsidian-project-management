import { describe, expect, it } from 'vitest';
import { AttachProjectAction } from '../../src/projects/AttachProjectAction.js';
import type { AttachProjectData } from '../../src/shared/AttachProjectData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import type {
  RepoBoardData,
  RepositoryBoardsData,
} from '../../src/shared/RepoBoardData.js';

// A fake port at the boundary: records what the action asked for and serves a
// canned board listing, so the action's own derivation behaviour is under test.
class FakePort implements ProjectManagementPort {
  repoBoards: RepositoryBoardsData = { repoNodeId: 'R_kgDOAAAA', boards: [] };
  identityCalls: AttachProjectData[] = [];
  identities = new Map<string, ProjectIdentityData>();

  async fetchRepoBoards(): Promise<RepositoryBoardsData> {
    return this.repoBoards;
  }
  async fetchProjectIdentity(
    data: AttachProjectData,
  ): Promise<ProjectIdentityData | null> {
    this.identityCalls.push(data);
    return this.identities.get(data.boardUrl) ?? null;
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
  async adoptBoard(): Promise<never> {
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

describe('ATT-1 — attach resolves the repo and derives the board', () => {
  it('adopts the single board linked to the repo', async () => {
    const port = new FakePort();
    const linked = board('widgets');
    port.repoBoards = { repoNodeId: 'R_kgDOAAAA', boards: [linked] };
    port.identities.set(linked.boardUrl, identity);
    const action = new AttachProjectAction(port);

    const result = await action.execute({ repoUrl });

    expect(port.identityCalls).toEqual([
      { pm: 'github', repoUrl, boardUrl: linked.boardUrl },
    ]);
    expect(result).toBe(identity);
  });

  it('resolves the repo alone when it has no board yet', async () => {
    const port = new FakePort();
    port.repoBoards = { repoNodeId: 'R_kgDOAAAA', boards: [] };
    const action = new AttachProjectAction(port);

    const result = await action.execute({ repoUrl });

    expect(result).toEqual({
      repoUrl,
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: '',
      statusFieldId: '',
      statusOptions: [],
    });
    expect(port.identityCalls).toEqual([]);
  });

  it('adopts the board titled with the repo name when several are linked', async () => {
    const port = new FakePort();
    const match = board('widgets');
    port.repoBoards = {
      repoNodeId: 'R_kgDOAAAA',
      boards: [board('Roadmap'), match],
    };
    port.identities.set(match.boardUrl, identity);
    const action = new AttachProjectAction(port);

    const result = await action.execute({ repoUrl });

    expect(port.identityCalls).toEqual([
      { pm: 'github', repoUrl, boardUrl: match.boardUrl },
    ]);
    expect(result).toBe(identity);
  });

  it('surfaces a discovery error when several boards match no repo name', async () => {
    const port = new FakePort();
    port.repoBoards = {
      repoNodeId: 'R_kgDOAAAA',
      boards: [board('Roadmap'), board('Backlog')],
    };
    const action = new AttachProjectAction(port);

    await expect(action.execute({ repoUrl })).rejects.toThrow(
      /several boards/,
    );
    expect(port.identityCalls).toEqual([]);
  });

  it('throws a domain error when a github connection is missing its repo url', async () => {
    const port = new FakePort();
    const action = new AttachProjectAction(port);

    await expect(action.execute({ repoUrl: '' })).rejects.toThrow(/repoUrl/);
    expect(port.identityCalls).toEqual([]);
  });
});
