import { describe, expect, it } from 'vitest';
import { PromoteIssueAction } from '../../../src/Domain/Actions/PromoteIssueAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { slugify } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the project management port records the labels it was
// asked to add and returns the task the action should materialise; the vault
// and sync state record what the note action creates. The promote action's
// own behaviour (label first, then materialise the fetched task) is what's
// under test, against the real CreateTaskNoteAction.
class FakePort implements ProjectManagementPort {
  addedLabels: Array<{ url: string; label: string }> = [];
  task: TaskData = {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the Bug!',
    body: 'The bug happens when the widget is resized.',
    state: 'open',
    updatedAt: '2026-09-18T10:00:00Z',
    labels: [],
  };

  async addLabel(url: string, label: string): Promise<void> {
    this.addedLabels.push({ url, label });
  }

  async fetchTask(): Promise<TaskData> {
    return this.task;
  }

  async fetchProjectIdentity(): Promise<null> {
    throw new Error('not used in this test');
  }
  async fetchChangedTasks(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchUnpromotedIssues(): Promise<never> {
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
  async promoteCard(): Promise<never> {
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
  async getLastPoll(): Promise<string | null> {
    return null;
  }
  async setLastPoll(): Promise<void> {}
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
}

function makeAction(
  port: FakePort,
  vault: FakeVault,
  syncState: FakeSyncState,
): PromoteIssueAction {
  return new PromoteIssueAction(
    port,
    syncState,
    new CreateTaskNoteAction(vault, syncState, 'Templates/Task.md'),
  );
}

describe('PromoteIssueAction', () => {
  it('applies the label and materialises the note from the fetched task', async () => {
    // Given — a port that returns the issue to promote and an empty vault
    const port = new FakePort();
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = makeAction(port, vault, syncState);

    // When — the action promotes the issue
    await action.execute({
      url: port.task.url,
      label: 'type: task',
      projectName: 'Acme Widgets',
    });

    // Then — the label is applied to the issue
    expect(port.addedLabels).toEqual([
      { url: port.task.url, label: 'type: task' },
    ]);
    // And the note is materialised from the fetched task, not on the next poll
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toContain(slugify(port.task.title));
  });

  it('applies the label idempotently even when the issue is already labelled', async () => {
    // Given — an issue that already carries the type: task label (the modal's
    // filter would hide it, but a direct promote still runs)
    const port = new FakePort();
    port.task = { ...port.task, labels: ['type: task'] };
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = makeAction(port, vault, syncState);

    // When — the action promotes the already-labelled issue
    await action.execute({
      url: port.task.url,
      label: 'type: task',
      projectName: 'Acme Widgets',
    });

    // Then — the label is still applied (GitHub labels are idempotent) and the
    // note is materialised
    expect(port.addedLabels).toEqual([
      { url: port.task.url, label: 'type: task' },
    ]);
    expect(vault.created).toHaveLength(1);
  });
});
