import { describe, expect, it } from 'vitest';
import { EnsureProjectBoardAction } from '../../src/projects/EnsureProjectBoardAction.js';
import type { BoardItemData } from '../../src/shared/BoardItemData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectBoardData } from '../../src/shared/ProjectBoardData.js';
import type { ProjectDetailData } from '../../src/shared/ProjectDetailData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectStateData } from '../../src/shared/ProjectStateData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import type {
  RepoBoardData,
  RepositoryBoardsData,
} from '../../src/shared/RepoBoardData.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: the project-management port serves a canned board listing
// and records the create/adopt calls, so the derivation ladder's decisions are
// what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  repoBoards: RepositoryBoardsData = { repoNodeId: 'R_kgDOAAAA', boards: [] };
  createCalls: Array<{ repoUrl: string; statusOptions: string[] }> = [];
  identityCalls: string[] = [];
  identities = new Map<string, ProjectIdentityData>();
  board: ProjectBoardData = {
    projectNodeId: 'PVT_new',
    boardUrl: 'https://github.com/users/acme/projects/7',
    statusFieldId: 'PVTF_new',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  };

  async fetchRepoBoards(): Promise<RepositoryBoardsData> {
    return this.repoBoards;
  }
  async createBoardWithStatusField(
    repoUrl: string,
    statusOptions: string[],
  ): Promise<ProjectBoardData> {
    this.createCalls.push({ repoUrl, statusOptions });
    return this.board;
  }
  async fetchProjectIdentity(data: {
    boardUrl: string;
  }): Promise<ProjectIdentityData | null> {
    this.identityCalls.push(data.boardUrl);
    return this.identities.get(data.boardUrl) ?? null;
  }
  async listRepoLabels(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createRepoLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectDetail(): Promise<ProjectDetailData> {
    throw new Error('not used in this test');
  }
  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<Map<string, ProjectStateData>> {
    return new Map();
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchUnpromotedIssues(): Promise<GithubTaskData[]> {
    return [];
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
  async fetchBoardItems(): Promise<BoardItemData[]> {
    return [];
  }
  async setBoardStatus(): Promise<void> {}
  async addBoardItem(): Promise<void> {}
  async deleteCard(): Promise<void> {}
  async addLabel(): Promise<void> {}
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const repoUrl = 'https://github.com/acme/widgets';
const projectName = 'Acme Widgets';
const statusOptions = ['Unshaped', 'Shaping', 'Shaped', 'Building', 'Shipped'];

function identity(
  overrides: Partial<ProjectIdentityData> = {},
): ProjectIdentityData {
  return {
    repoUrl: '',
    repoNodeId: '',
    projectNodeId: '',
    statusFieldId: '',
    statusOptions: [],
    ...overrides,
  };
}

function board(
  name: string,
  url = `https://github.com/users/acme/projects/${name.length}`,
): RepoBoardData {
  return { projectNodeId: `PVT_${name}`, name, boardUrl: url };
}

function setup(stored?: ProjectIdentityData) {
  const port = new FakeProjectManagement();
  const syncState = new FakeSyncState();
  if (stored !== undefined) {
    syncState.identities.set(projectName, stored);
  }
  const action = new EnsureProjectBoardAction(port, syncState, statusOptions);
  return { action, port, syncState };
}

describe('PRJ-1 — the board is derived from the repository', () => {
  it('creates, links and gives a Status field when the repo has no board', async () => {
    const h = setup(identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }));

    await h.action.execute({ projectName });

    expect(h.port.createCalls).toEqual([{ repoUrl, statusOptions }]);
    expect(h.port.identityCalls).toEqual([]);
    expect(await h.syncState.getIdentity(projectName)).toEqual({
      repoUrl,
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_new',
      statusFieldId: 'PVTF_new',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    });
  });

  it('adopts the single board linked to the repo', async () => {
    const h = setup(identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }));
    const linked = board('widgets');
    h.port.repoBoards = { repoNodeId: 'R_kgDOAAAA', boards: [linked] };
    h.port.identities.set(
      linked.boardUrl,
      identity({
        repoUrl,
        repoNodeId: 'R_kgDOAAAA',
        projectNodeId: 'PVT_widgets',
        statusFieldId: 'PVTF_live',
        statusOptions: [{ id: 'PVTSSF_live', name: 'Shipped' }],
      }),
    );

    await h.action.execute({ projectName });

    expect(h.port.createCalls).toEqual([]);
    expect(h.port.identityCalls).toEqual([linked.boardUrl]);
    expect(await h.syncState.getIdentity(projectName)).toEqual({
      repoUrl,
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_widgets',
      statusFieldId: 'PVTF_live',
      statusOptions: [{ id: 'PVTSSF_live', name: 'Shipped' }],
    });
  });

  it('adopts the board titled with the repo name when several are linked', async () => {
    const h = setup(identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }));
    const other = board('Roadmap');
    const match = board('widgets');
    h.port.repoBoards = {
      repoNodeId: 'R_kgDOAAAA',
      boards: [other, match],
    };
    h.port.identities.set(
      match.boardUrl,
      identity({
        repoUrl,
        repoNodeId: 'R_kgDOAAAA',
        projectNodeId: 'PVT_widgets',
        statusFieldId: 'PVTF_live',
        statusOptions: [{ id: 'PVTSSF_live', name: 'Shipped' }],
      }),
    );

    await h.action.execute({ projectName });

    expect(h.port.createCalls).toEqual([]);
    expect(h.port.identityCalls).toEqual([match.boardUrl]);
    expect((await h.syncState.getIdentity(projectName))?.projectNodeId).toBe(
      'PVT_widgets',
    );
  });

  it('surfaces a discovery error when several boards match no repo name', async () => {
    const h = setup(identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }));
    h.port.repoBoards = {
      repoNodeId: 'R_kgDOAAAA',
      boards: [board('Roadmap'), board('Backlog')],
    };

    await expect(h.action.execute({ projectName })).rejects.toThrow(
      /several boards/,
    );

    expect(h.port.createCalls).toEqual([]);
    expect(h.port.identityCalls).toEqual([]);
    expect(await h.syncState.getIdentity(projectName)).toEqual(
      identity({ repoUrl, repoNodeId: 'R_kgDOAAAA' }),
    );
  });

  it('is idempotent: an identity that already has a board is left alone', async () => {
    const h = setup(identity({ repoUrl, projectNodeId: 'PVT_existing' }));

    await h.action.execute({ projectName });

    expect(h.port.createCalls).toEqual([]);
    expect(h.port.identityCalls).toEqual([]);
    expect((await h.syncState.getIdentity(projectName))?.projectNodeId).toBe(
      'PVT_existing',
    );
  });

  it('leaves a repo-less project board-less', async () => {
    const h = setup(identity({ repoUrl: '' }));

    await h.action.execute({ projectName });

    expect(h.port.createCalls).toEqual([]);
    expect(h.port.identityCalls).toEqual([]);
    expect(await h.syncState.getIdentity(projectName)).toEqual(
      identity({ repoUrl: '' }),
    );
  });
});
