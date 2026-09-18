import { describe, expect, it } from 'vitest';
import {
  SyncStateAdapter,
  type SyncStateStorage,
} from '../../../src/Infrastructure/Obsidian/SyncStateAdapter.js';
import type { Status } from '../../../src/Domain/Models/Status.js';

// A fake storage at the boundary: an in-memory map behind load/save, so the
// adapter's keying and round-tripping is what's under test.
function fakeStorage() {
  let data: Record<string, unknown> = {};
  const storage: SyncStateStorage = {
    async load() {
      return data;
    },
    async save(next: unknown) {
      data = next as Record<string, unknown>;
    },
  };
  return { storage, snapshot: () => data };
}

const status: Status = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
  lastSyncedBodyHash: 'abc123',
  lastSyncedRemoteUpdatedAt: '2026-09-18T10:00:00Z',
  lastSyncedStatus: 'open',
};

describe('SyncStateAdapter', () => {
  it('round-trips a status record under a namespaced key', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a status is set then read back
    await adapter.set(status);
    const result = await adapter.get(status.url);

    // Then — the record round-trips intact
    expect(result).toEqual(status);
  });

  it('returns null for an unknown status url', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an unknown url is read
    const result = await adapter.get('https://github.com/acme/widgets/issues/999');

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('round-trips the last poll cursor per project', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a last poll is set then read back
    await adapter.setLastPoll('Acme Widgets', '2026-09-18T12:00:00Z');
    const result = await adapter.getLastPoll('Acme Widgets');

    // Then — the cursor round-trips
    expect(result).toBe('2026-09-18T12:00:00Z');
  });

  it('returns null for a project with no last poll', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an unknown project is read
    const result = await adapter.getLastPoll('Other Project');

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('keeps status and last poll records distinct under their namespaced keys', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — both a status and a last poll are written
    await adapter.set(status);
    await adapter.setLastPoll('Acme Widgets', '2026-09-18T12:00:00Z');

    // Then — they live under separate namespaced keys
    expect(snapshot()).toEqual({
      'status.https://github.com/acme/widgets/issues/42': status,
      'lastPoll.Acme Widgets': '2026-09-18T12:00:00Z',
    });
  });
});
