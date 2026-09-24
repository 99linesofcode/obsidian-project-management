import { describe, expect, it } from 'vitest';
import { RelocateTaskStatusAction } from '../../../src/Domain/Actions/RelocateTaskStatusAction.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';

// Fakes at the sync-state port: an in-memory record list that records every
// save, so the relocate's single decision (move the record or not) is
// observable.
class FakeSyncState implements SyncStatePort {
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }

  async setLastProjectUpdate(): Promise<void> {}
  records: Status[] = [];
  saved: Status[] = [];

  async get(): Promise<Status | null> {
    return null;
  }
  async set(status: Status): Promise<void> {
    this.saved.push(status);
  }
  async findByNotePath(notePath: string): Promise<Status | null> {
    return this.records.find((record) => record.notePath === notePath) ?? null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return this.records;
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return null;
  }
}

const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const newPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug-v2.md';

function record(notePath: string): Status {
  return {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    notePath,
    lastSyncedBodyHash: 'abc',
    lastSyncedRemoteUpdatedAt: '2026-09-18T11:00:00Z',
    lastSyncedStatus: 'Building',
    lastSyncedTitle: 'Fix the bug',
  };
}

describe('RelocateTaskStatusAction', () => {
  it("moves the Status record's notePath to the new path", async () => {
    // Given — a Status record pointing at the note's old path
    const syncState = new FakeSyncState();
    syncState.records.push(record(oldPath));
    const action = new RelocateTaskStatusAction(syncState);

    // When — the task note rename is followed
    await action.execute({ oldPath, newPath });

    // Then — the record is saved under the new path, its fields intact
    expect(syncState.saved).toEqual([
      { ...record(oldPath), notePath: newPath },
    ]);
  });

  it('does nothing when no record matches the old path', async () => {
    // Given — no Status record for the renamed note
    const syncState = new FakeSyncState();
    const action = new RelocateTaskStatusAction(syncState);

    // When — the task note rename is followed
    await action.execute({ oldPath, newPath });

    // Then — nothing is saved
    expect(syncState.saved).toEqual([]);
  });
});
