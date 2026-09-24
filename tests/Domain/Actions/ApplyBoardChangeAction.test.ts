import { describe, expect, it } from 'vitest';
import { ApplyBoardChangeAction } from '../../../src/Domain/Actions/ApplyBoardChangeAction.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import { withStatus } from '../../../src/Domain/Notes/TaskNoteParser.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: hold notes and status records in memory and record the
// state changes and note rewrites the action asks for, so the action's own
// behaviour (board vs issue disagreement → close/reopen + flip + baseline) is
// what's under test.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  written: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(): Promise<void> {
    throw new Error('not used in this test');
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
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
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }

  async setLastProjectUpdate(): Promise<void> {}
  statuses = new Map<string, Status>();
  setCalls: Status[] = [];

  async get(url: string): Promise<Status | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: Status): Promise<void> {
    this.statuses.set(status.url, status);
    this.setCalls.push(status);
  }
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return [];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<null> {
    return null;
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  updated: TaskData = {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the Bug!',
    body: 'The bug happens when the widget is resized.',
    state: 'closed',
    updatedAt: '2026-09-18T12:30:00Z',
    labels: ['type: task'],
  };

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchTrackedIssues(): Promise<TaskData[]> {
    return [];
  }
  async fetchTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async setTaskState(url: string, state: 'open' | 'closed'): Promise<TaskData> {
    this.stateCalls.push({ url, state });
    return this.updated;
  }
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setBoardStatus(): Promise<void> {
    throw new Error('not used in this test');
  }
  async addBoardItem(): Promise<void> {
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

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const noteContent = [
  '---',
  'categories: [taken]',
  `url: ${url}`,
  'status: open',
  'affiliation: ["[[Acme Widgets]]"]',
  'synced: 2026-09-18T12:00:00Z',
  '---',
  'The bug happens when the widget is resized.',
].join('\n');

function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    url,
    remoteId: 42,
    notePath,
    lastSyncedBodyHash: hash('The bug happens when the widget is resized.'),
    lastSyncedRemoteUpdatedAt: '2026-09-18T10:00:00Z',
    lastSyncedStatus: 'Building',
    lastSyncedTitle: 'Fix the Bug!',
    ...overrides,
  };
}

function makeItem(overrides: Partial<BoardItemData> = {}): BoardItemData {
  return {
    itemId: 'PVTI_1',
    type: 'ISSUE',
    issueUrl: url,
    statusOptionName: 'Shipped',
    ...overrides,
  };
}

function makeAction(
  vault: FakeVault,
  syncState: FakeSyncState,
  projectManagement: FakeProjectManagement,
) {
  return new ApplyBoardChangeAction(
    syncState,
    projectManagement,
    vault,
    'Shipped',
  );
}

describe('ApplyBoardChangeAction', () => {
  it('carries a non-done lane onto the note and leaves the issue alone', async () => {
    // Given — a tracked issue whose card moved to Unshaped while the baseline
    // says Building; both lanes are non-done, so the issue is untouched
    const vault = new FakeVault();
    vault.notes.set(notePath, withStatus(noteContent, 'Building'));
    const syncState = new FakeSyncState();
    syncState.statuses.set(url, makeStatus({ lastSyncedStatus: 'Building' }));
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the board change is applied
    await action.execute({
      projectName: 'Acme Widgets',
      item: makeItem({ statusOptionName: 'Unshaped' }),
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the note carries the lane, body preserved
    expect(vault.written).toEqual([
      { path: notePath, content: withStatus(noteContent, 'Unshaped') },
    ]);
    // And the issue state was never touched
    expect(projectManagement.stateCalls).toHaveLength(0);
    // And the baseline tracks the new lane
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.lastSyncedStatus).toBe('Unshaped');
  });

  it('closes the issue, flips the note and refreshes the baseline when the board is done but the issue is open', async () => {
    // Given — a tracked open issue whose board card is Done
    const vault = new FakeVault();
    vault.notes.set(notePath, noteContent);
    const syncState = new FakeSyncState();
    syncState.statuses.set(url, makeStatus());
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = {
      ...projectManagement.updated,
      state: 'closed',
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the board change is applied
    await action.execute({
      projectName: 'Acme Widgets',
      item: makeItem(),
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the issue is closed
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
    // And the note's status line is flipped to done, body preserved
    expect(vault.written).toEqual([
      { path: notePath, content: withStatus(noteContent, 'Shipped') },
    ]);
    // And the baseline is refreshed from the response
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.lastSyncedStatus).toBe('Shipped');
    expect(syncState.setCalls[0]!.lastSyncedRemoteUpdatedAt).toBe(
      '2026-09-18T12:30:00Z',
    );
  });

  it('reopens the issue, flips the note and refreshes the baseline when the board is not done but the issue is closed', async () => {
    // Given — a tracked closed issue whose board card is In progress
    const vault = new FakeVault();
    vault.notes.set(notePath, withStatus(noteContent, 'done'));
    const syncState = new FakeSyncState();
    syncState.statuses.set(url, makeStatus({ lastSyncedStatus: 'Shipped' }));
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = { ...projectManagement.updated, state: 'open' };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the board change is applied
    await action.execute({
      projectName: 'Acme Widgets',
      item: makeItem({ statusOptionName: 'Building' }),
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the issue is reopened
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'open' }]);
    // And the note's status line is flipped to open
    expect(vault.written).toEqual([
      { path: notePath, content: withStatus(noteContent, 'Building') },
    ]);
    // And the baseline is refreshed
    expect(syncState.setCalls[0]!.lastSyncedStatus).toBe('Building');
  });

  it('does nothing when the board and the issue agree', async () => {
    // Given — a tracked done issue whose board card is also Done
    const vault = new FakeVault();
    vault.notes.set(notePath, withStatus(noteContent, 'Shipped'));
    const syncState = new FakeSyncState();
    syncState.statuses.set(url, makeStatus({ lastSyncedStatus: 'Shipped' }));
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the board change is applied
    await action.execute({
      projectName: 'Acme Widgets',
      item: makeItem(),
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — nothing is closed, reopened, rewritten or re-recorded
    expect(projectManagement.stateCalls).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });

  it('skips a draft card with no issue url', async () => {
    // Given — a draft card (no issue url)
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the board change is applied
    await action.execute({
      projectName: 'Acme Widgets',
      item: { itemId: 'PVTI_1', type: 'DRAFT_ISSUE' },
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — nothing happens
    expect(projectManagement.stateCalls).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });

  it('skips an item with no Status value set', async () => {
    // Given — a board card with no Status option name
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the board change is applied
    await action.execute({
      projectName: 'Acme Widgets',
      item: { itemId: 'PVTI_1', type: 'ISSUE', issueUrl: url },
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — nothing happens
    expect(projectManagement.stateCalls).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });

  it('skips an item whose issue has no status record', async () => {
    // Given — a board card for an untracked issue
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the board change is applied
    await action.execute({
      projectName: 'Acme Widgets',
      item: makeItem(),
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — nothing happens
    expect(projectManagement.stateCalls).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });
});
