import { describe, expect, it } from 'vitest';
import { PromoteIssueAction } from '../../../src/Domain/Actions/PromoteIssueAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { slugify } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

// Fakes at the ports: the project management port records the labels it was
// asked to add and returns the task the action should materialise; the vault
// and registry record what the note action creates. The promote action's own
// behaviour (label first, then materialise the fetched task) is what's under
// test, against the real CreateTaskNoteAction.
class FakePort implements ProjectManagementPort {
  addedLabels: Array<{ url: string; label: string }> = [];
  task: GithubTaskData = {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the Bug!',
    body: 'The bug happens when the widget is resized.',
    state: 'open',
    createdAt: null,
    lastEditedAt: null,
    updatedAt: '2026-09-18T10:00:00Z',
    labels: [],
  };

  async addLabel(url: string, label: string): Promise<void> {
    this.addedLabels.push({ url, label });
  }
  async fetchTask(): Promise<GithubTaskData> {
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
  async deleteCard(): Promise<never> {
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
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
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
): PromoteIssueAction {
  return new PromoteIssueAction(
    port,
    syncState,
    new CreateTaskNoteAction(vault, syncState, ''),
  );
}

function identity(): ProjectIdentityData {
  return {
    repoUrl: 'https://github.com/acme/widgets',
    repoNodeId: 'R_kgDOAAAA',
    projectNodeId: 'PVT_123',
    statusFieldId: 'PVTF_456',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  };
}

describe('PromoteIssueAction', () => {
  it('applies the label and materialises the note from the fetched task', async () => {
    // Given — a port that returns the issue to promote and an empty vault
    const port = new FakePort();
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity());
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
    // And the promoted label became the vault-owned type
    expect(vault.created[0]!.content).toContain('type: task');
  });

  it('applies the label idempotently even when the issue is already labelled', async () => {
    // Given — an issue that already carries the type: task label (the modal's
    // filter would hide it, but a direct promote still runs)
    const port = new FakePort();
    port.task = { ...port.task, labels: ['type: task'] };
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity());
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
