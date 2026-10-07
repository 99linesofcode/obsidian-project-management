import { describe, expect, it } from 'vitest';
import { PromoteCardAction } from '../../src/tasks/PromoteCardAction.js';
import { CreateTaskNoteAction } from '../../src/tasks/CreateTaskNoteAction.js';
import { slugify } from '../../src/vault/TaskNoteMapper.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: the project management port records the draft card it
// was asked to promote and returns the resulting task; the vault and registry
// record what the note action creates. The promote action's own behaviour
// (convert the card, then materialise the fetched task) is what's under test,
// against the real CreateTaskNoteAction.
class FakePort implements ProjectManagementPort {
  promoted: Array<{ itemId: string; repoNodeId: string }> = [];
  task: GithubTaskData = {
    url: 'https://github.com/acme/widgets/issues/50',
    nodeId: 'I_kwDOAAAA50',
    title: 'An idea',
    body: 'The draft body.',
    state: 'open',
    createdAt: null,
    lastEditedAt: null,
    updatedAt: '2026-09-19T10:00:00Z',
    labels: [],
    parentUrl: null,
  };

  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(
    itemId: string,
    repoNodeId: string,
  ): Promise<GithubTaskData> {
    this.promoted.push({ itemId, repoNodeId });
    return this.task;
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchProjectDetail(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchTrackedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchUnpromotedIssues(): Promise<never> {
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
  async addLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchRepoBoards(): Promise<never> {
    throw new Error('not used in this test');
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
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
}

class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  created: Array<{ path: string; content: string }> = [];

  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }
  async createNote(path: string, content: string): Promise<void> {
    this.created.push({ path, content });
  }
  async writeNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  async moveFolder(): Promise<void> {}
  async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  async findProjectNotes(): Promise<[]> {
    return [];
  }
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

function makeAction(
  port: FakePort,
  vault: FakeVault,
  syncState: FakeSyncState,
): PromoteCardAction {
  return new PromoteCardAction(
    port,
    syncState,
    new CreateTaskNoteAction(vault, syncState, ''),
    vault,
  );
}

describe('PRO-2 — a card without an issue is promoted', () => {
  it('converts the draft card and materialises the note from the fetched task', async () => {
    const port = new FakePort();
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const identity: ProjectIdentityData = {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    };
    syncState.identities.set('Acme Widgets', identity);
    const action = makeAction(port, vault, syncState);

    await action.execute({
      itemId: 'PVTI_2',
      repoNodeId: 'R_kgDOAAAA',
      projectName: 'Acme Widgets',
    });

    expect(port.promoted).toEqual([
      { itemId: 'PVTI_2', repoNodeId: 'R_kgDOAAAA' },
    ]);
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toContain(slugify(port.task.title));
  });
});
