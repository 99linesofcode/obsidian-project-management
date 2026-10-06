import { describe, expect, it } from 'vitest';
import { EnsureProjectBoardAction } from '../../../src/Domain/Actions/EnsureProjectBoardAction.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectBoardData } from '../../../src/Domain/DataTransferObjects/ProjectBoardData.js';
import type { ProjectDetailData } from '../../../src/Domain/DataTransferObjects/ProjectDetailData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

// Fakes at the ports: the project-management port records board creations and
// serves a canned board; the vault holds the home note so the board anchor's
// stamping is observable.
class FakeProjectManagement implements ProjectManagementPort {
  createCalls: string[] = [];
  board: ProjectBoardData = {
    projectNodeId: 'PVT_new',
    boardUrl: 'https://github.com/users/acme/projects/7',
    statusFieldId: 'PVTF_new',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  };

  async createProject(name: string): Promise<ProjectBoardData> {
    this.createCalls.push(name);
    return this.board;
  }

  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
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
}

class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  writes: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.notes.set(path, content);
  }
  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }
  async modifiedTime(): Promise<string | null> {
    return null;
  }
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(): Promise<string[]> {
    return [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

const notePath = 'Projecten/Acme Widgets/_Acme Widgets.md';
const homeNote = '---\npm: github\n---\n';

function identity(overrides: Partial<ProjectIdentityData> = {}): ProjectIdentityData {
  return {
    repoUrl: '',
    repoNodeId: '',
    projectNodeId: '',
    statusFieldId: '',
    statusOptions: [],
    ...overrides,
  };
}

function setup(stored?: ProjectIdentityData) {
  const port = new FakeProjectManagement();
  const vault = new FakeVault();
  vault.notes.set(notePath, homeNote);
  const syncState = new FakeSyncState();
  if (stored !== undefined) {
    syncState.identities.set('Acme Widgets', stored);
  }
  const action = new EnsureProjectBoardAction(port, vault, syncState);
  return { action, port, vault, syncState };
}

describe('EnsureProjectBoardAction', () => {
  it('creates a board and stores its addressing when the identity has none', async () => {
    // Given — a vault project with no stored identity
    const h = setup();

    // When — the board is ensured
    await h.action.execute({ projectName: 'Acme Widgets', notePath });

    // Then — a board is created under the viewer and its identity is stored
    expect(h.port.createCalls).toEqual(['Acme Widgets']);
    expect(await h.syncState.getIdentity('Acme Widgets')).toEqual({
      repoUrl: '',
      repoNodeId: '',
      projectNodeId: 'PVT_new',
      statusFieldId: 'PVTF_new',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    });
    // And — the board url is stamped onto the home note as the board anchor
    expect(h.vault.notes.get(notePath)).toContain(
      'board: https://github.com/users/acme/projects/7',
    );
  });

  it('is idempotent: an identity that already has a board is left alone', async () => {
    // Given — a project already carrying a board node id
    const h = setup(identity({ projectNodeId: 'PVT_existing' }));

    // When — the board is ensured
    await h.action.execute({ projectName: 'Acme Widgets', notePath });

    // Then — no board is created and no note is written
    expect(h.port.createCalls).toEqual([]);
    expect(h.vault.writes).toEqual([]);
    expect((await h.syncState.getIdentity('Acme Widgets'))?.projectNodeId).toBe(
      'PVT_existing',
    );
  });

  it('preserves an attached repository when it fills in the board', async () => {
    // Given — a project with a repo attached but no board yet
    const h = setup(
      identity({
        repoUrl: 'https://github.com/acme/widgets',
        repoNodeId: 'R_kgDOAAAA',
      }),
    );

    // When — the board is ensured
    await h.action.execute({ projectName: 'Acme Widgets', notePath });

    // Then — the repo addressing survives the merge
    expect(await h.syncState.getIdentity('Acme Widgets')).toEqual({
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_new',
      statusFieldId: 'PVTF_new',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    });
  });
});
