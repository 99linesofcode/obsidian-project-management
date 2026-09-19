import { describe, expect, it } from 'vitest';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import { TaskStatus } from '../../../src/Domain/Enums/TaskStatus.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';

// Fakes at the ports: record what the action asked for, so the action's own
// behaviour (create + record, or no-op) is what's under test.
class FakeVault implements VaultPort {
  existing: { content: string } | null = null;
  created: Array<{ path: string; content: string }> = [];

  async getNoteByPath(): Promise<{ content: string } | null> {
    return this.existing;
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

  onNoteChanged(): void {
    throw new Error('not used in this test');
  }

  onNoteDeleted(): void {
    throw new Error('not used in this test');
  }
}

class FakeSyncState implements SyncStatePort {
  stored: Status[] = [];

  async get(): Promise<Status | null> {
    return null;
  }

  async set(status: Status): Promise<void> {
    this.stored.push(status);
  }

  async findByNotePath(): Promise<Status | null> {
    return null;
  }

  async remove(): Promise<void> {
    throw new Error('not used in this test');
  }

  async getLastPoll(): Promise<string | null> {
    return null;
  }

  async setLastPoll(): Promise<void> {
    throw new Error('not used in this test');
  }

  async setIdentity(): Promise<void> {
    throw new Error('not used in this test');
  }

  async getIdentity(): Promise<null> {
    return null;
  }

  async list(): Promise<Status[]> {
    return [];
  }
}

const task: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: [],
};

describe('CreateTaskNoteAction', () => {
  it('creates the note and writes the status record', async () => {
    // Given — a vault with no existing note and an empty sync state
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState);

    // When — the action materialises the task note
    await action.execute({
      task,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the note is created at the mapped path with the mapped content
    const { path, content } = TaskNoteMapper.map(task, {
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });
    expect(vault.created).toEqual([{ path, content }]);
    // And the status record is written with the body hash and remote updatedAt
    expect(syncState.stored).toEqual([
      {
        url: task.url,
        remoteId: task.remoteId,
        notePath: path,
        lastSyncedBodyHash: hash(task.body),
        lastSyncedRemoteUpdatedAt: task.updatedAt,
        lastSyncedStatus: TaskStatus.Open,
        lastSyncedTitle: task.title,
      },
    ]);
  });

  it('is a no-op when the note already exists', async () => {
    // Given — a vault that already holds the note
    const vault = new FakeVault();
    vault.existing = { content: 'already there' };
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState);

    // When — the action runs
    await action.execute({
      task,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — nothing is created and no status record is written
    expect(vault.created).toEqual([]);
    expect(syncState.stored).toEqual([]);
  });
});
