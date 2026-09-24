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
  lastSyncedTitle: 'Fix the Bug!',
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
    const result = await adapter.get(
      'https://github.com/acme/widgets/issues/999',
    );

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('keeps status records under their namespaced key', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a status is written
    await adapter.set(status);

    // Then — it lives under its namespaced key
    expect(snapshot()).toEqual({
      'status.https://github.com/acme/widgets/issues/42': status,
    });
  });

  it('finds a status record by its note path', async () => {
    // Given — a stored status record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(status);

    // When — the record is looked up by its note path
    const result = await adapter.findByNotePath(status.notePath);

    // Then — the record is returned
    expect(result).toEqual(status);
  });

  it('returns null when no record matches the note path', async () => {
    // Given — a stored status record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(status);

    // When — an unknown note path is looked up
    const result = await adapter.findByNotePath(
      'Projecten/Other/taken/99-unknown.md',
    );

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('removes a status record by its url', async () => {
    // Given — a stored status record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(status);

    // When — the record is removed
    await adapter.remove(status.url);

    // Then — the record is gone
    expect(await adapter.get(status.url)).toBeNull();
  });

  it('lists every stored status record', async () => {
    // Given — two stored status records
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const other: Status = {
      ...status,
      url: 'https://github.com/acme/widgets/issues/43',
      remoteId: 43,
    };
    await adapter.set(status);
    await adapter.set(other);

    // When — all records are listed
    const result = await adapter.list();

    // Then — both records are returned
    expect(result).toEqual([status, other]);
  });

  it('lists an empty array when no status records exist', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — all records are listed
    const result = await adapter.list();

    // Then — an empty array is returned
    expect(result).toEqual([]);
  });

  it('round-trips a project identity under a namespaced key', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const identity = {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    };

    // When — an identity is set then read back
    await adapter.setIdentity('Acme Widgets', identity);
    const result = await adapter.getIdentity('Acme Widgets');

    // Then — the identity round-trips intact
    expect(result).toEqual(identity);
  });

  it('returns null for a project with no stored identity', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an unknown project is read
    const result = await adapter.getIdentity('Other Project');

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('keeps identities distinct from status records', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const identity = {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    };

    // When — an identity is written alongside a status
    await adapter.setIdentity('Acme Widgets', identity);
    await adapter.set(status);

    // Then — each lives under its own namespaced key
    expect(snapshot()).toEqual({
      'identity.Acme Widgets': identity,
      'status.https://github.com/acme/widgets/issues/42': status,
    });
  });

  it('round-trips a project update under a namespaced key', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a project update is set then read back
    await adapter.setLastProjectUpdate('Acme Widgets', '2026-09-18T10:00:00Z');
    const result = await adapter.getLastProjectUpdate('Acme Widgets');

    // Then — the update round-trips intact
    expect(result).toBe('2026-09-18T10:00:00Z');
  });

  it('returns null for a project with no stored update', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an unknown project is read
    const result = await adapter.getLastProjectUpdate('Other Project');

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('keeps project updates distinct from status records and identities', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const identity = {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    };

    // When — a project update is written alongside a status and an identity
    await adapter.setLastProjectUpdate('Acme Widgets', '2026-09-18T10:00:00Z');
    await adapter.setIdentity('Acme Widgets', identity);
    await adapter.set(status);

    // Then — each lives under its own namespaced key
    expect(snapshot()).toEqual({
      'projectUpdate.Acme Widgets': '2026-09-18T10:00:00Z',
      'identity.Acme Widgets': identity,
      'status.https://github.com/acme/widgets/issues/42': status,
    });
  });
});
