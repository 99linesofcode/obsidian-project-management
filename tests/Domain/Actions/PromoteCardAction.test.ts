import { describe, expect, it } from 'vitest';
import { PromoteCardAction } from '../../../src/Domain/Actions/PromoteCardAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { slugify } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the project management port records the draft card it
// was asked to promote and returns the resulting task; the vault and sync
// state record what the note action creates. The promote action's own
// behaviour (convert the card, then materialise the fetched task) is what's
// under test, against the real CreateTaskNoteAction.
class FakePort implements ProjectManagementPort {
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  promoted: Array<{ itemId: string; repoNodeId: string }> = [];
  task: TaskData = {
    url: 'https://github.com/acme/widgets/issues/50',
    remoteId: 50,
    nodeId: 'I_kwDOAAAA50',
    title: 'An idea',
    body: 'The draft body.',
    state: 'open',
    updatedAt: '2026-09-19T10:00:00Z',
    labels: [],
  };

  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }

  async promoteCard(itemId: string, repoNodeId: string): Promise<TaskData> {
    this.promoted.push({ itemId, repoNodeId });
    return this.task;
  }

  async fetchProjectIdentity(): Promise<null> {
    throw new Error('not used in this test');
  }
  async fetchTrackedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }
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
}

class FakeVault implements VaultPort {
  created: Array<{ path: string; content: string }> = [];

  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }

  async createNote(path: string, content: string): Promise<void> {
    this.created.push({ path, content });
  }

  async writeNote(): Promise<void> {
    throw new Error('not used in this test');
  }

  async moveFolder(): Promise<void> {}
  async renameNote(): Promise<void> {
    throw new Error('not used in this test');
  }

  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }

  async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  onNoteChanged(): void {
    throw new Error('not used in this test');
  }

  onNoteDeleted(): void {
    throw new Error('not used in this test');
  }
  onNoteRenamed(): void {}
}

class FakeSyncState implements SyncStatePort {
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }

  async setLastProjectUpdate(): Promise<void> {}
  async getArchiveBaseline(): Promise<null> {
    return null;
  }
  async getWatchState(): Promise<{
    etag: string | null;
    cursor: string | null;
  }> {
    return { etag: null, cursor: null };
  }

  async setWatchState(): Promise<void> {}

  async setArchiveBaseline(): Promise<void> {}
  identity = {
    repoUrl: 'https://github.com/acme/widgets',
    repoNodeId: 'R_kgDOAAAA',
    projectNodeId: 'PVT_123',
    statusFieldId: 'PVTF_456',
    statusOptions: [
      { id: 'PVTSSF_1', name: 'Unshaped' },
      { id: 'PVTSSF_2', name: 'Shaping' },
      { id: 'PVTSSF_3', name: 'Shaped' },
      { id: 'PVTSSF_4', name: 'Building' },
      { id: 'PVTSSF_5', name: 'Shipped' },
    ],
  };

  async get(): Promise<Status | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return [];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
}

function makeAction(
  port: FakePort,
  vault: FakeVault,
  syncState: FakeSyncState,
): PromoteCardAction {
  return new PromoteCardAction(
    port,
    syncState,
    new CreateTaskNoteAction(vault, syncState, 'Templates/Task.md'),
  );
}

describe('PromoteCardAction', () => {
  it('converts the draft card and materialises the note from the fetched task', async () => {
    // Given — a port that promotes the card and an empty vault
    const port = new FakePort();
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = makeAction(port, vault, syncState);

    // When — the action promotes the draft card
    await action.execute({
      itemId: 'PVTI_2',
      repoNodeId: 'R_kgDOAAAA',
      projectName: 'Acme Widgets',
    });

    // Then — the card is converted against the repo
    expect(port.promoted).toEqual([
      { itemId: 'PVTI_2', repoNodeId: 'R_kgDOAAAA' },
    ]);
    // And the note is materialised from the fetched task, not on the next poll
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toContain(slugify(port.task.title));
  });
});
