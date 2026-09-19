import { describe, expect, it } from 'vitest';
import { ApplyRemoteChangeAction } from '../../../src/Domain/Actions/ApplyRemoteChangeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import { TaskStatus } from '../../../src/Domain/Enums/TaskStatus.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';

// Fakes at the ports: hold notes and status records in memory and record the
// operations the action performs, so the action's own behaviour is under test.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  written: Array<{ path: string; content: string }> = [];
  renamed: Array<{ oldPath: string; newPath: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }

  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = this.notes.get(oldPath);
    if (content !== undefined) {
      this.notes.delete(oldPath);
      this.notes.set(newPath, content);
    }
    this.renamed.push({ oldPath, newPath });
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
}

const task: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: ['type:task'],
};

const context = { projectName: 'Acme Widgets', syncedAt: '2026-09-18T12:00:00Z' };

function makeStatus(overrides: Partial<Status> = {}): Status {
  const { path } = TaskNoteMapper.map(task, context);
  return {
    url: task.url,
    remoteId: task.remoteId,
    notePath: path,
    lastSyncedBodyHash: hash(task.body),
    lastSyncedRemoteUpdatedAt: task.updatedAt,
    lastSyncedStatus: TaskStatus.Open,
    lastSyncedTitle: task.title,
    ...overrides,
  };
}

function makeAction(vault: FakeVault, syncState: FakeSyncState) {
  const createTaskNote = new CreateTaskNoteAction(vault, syncState);
  return new ApplyRemoteChangeAction(vault, syncState, createTaskNote);
}

describe('ApplyRemoteChangeAction', () => {
  it('updates the note body and status when the remote changed', async () => {
    // Given — a synced note whose remote body has since changed
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState);
    const changed: TaskData = {
      ...task,
      body: 'The bug now also happens on resize.',
      updatedAt: '2026-09-18T11:00:00Z',
    };

    // When — the remote change is applied
    await action.execute({ task: changed, ...context });

    // Then — the note is rewritten with the new body
    const { content: newContent } = TaskNoteMapper.map(changed, context);
    expect(vault.written).toEqual([{ path, content: newContent }]);
    // And the status record is updated with the new hash and updatedAt
    expect(syncState.setCalls).toEqual([
      {
        url: task.url,
        remoteId: task.remoteId,
        notePath: path,
        lastSyncedBodyHash: hash(changed.body),
        lastSyncedRemoteUpdatedAt: changed.updatedAt,
        lastSyncedStatus: TaskStatus.Open,
        lastSyncedTitle: changed.title,
      },
    ]);
  });

  it('renames the note and updates notePath when the title changed', async () => {
    // Given — a synced note whose remote title has since changed
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState);
    const retitled: TaskData = { ...task, title: 'Fix the Widget!' };

    // When — the remote change is applied
    await action.execute({ task: retitled, ...context });

    // Then — the note is renamed to the new mapped path
    const { path: newPath } = TaskNoteMapper.map(retitled, context);
    expect(vault.renamed).toEqual([{ oldPath: path, newPath }]);
    // And the status record's notePath follows the rename
    expect(syncState.setCalls[0]!.notePath).toBe(newPath);
  });

  it('skips silently when nothing changed', async () => {
    // Given — a synced note whose remote is unchanged
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState);

    // When — the unchanged remote change is applied
    await action.execute({ task, ...context });

    // Then — nothing is written, renamed or re-recorded
    expect(vault.written).toEqual([]);
    expect(vault.renamed).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });

  it('materialises a note when no status record exists', async () => {
    // Given — a task with no status record (a newly promoted issue)
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = makeAction(vault, syncState);

    // When — the remote change is applied
    await action.execute({ task, ...context });

    // Then — the note is created via the create action
    const { path, content } = TaskNoteMapper.map(task, context);
    expect(vault.created).toEqual([{ path, content }]);
    // And a status record is written
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.notePath).toBe(path);
  });
});
