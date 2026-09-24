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

  it('round-trips an archive baseline under a namespaced key', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a baseline is set then read back
    await adapter.setArchiveBaseline('Acme Widgets', {
      locationArchived: true,
      closed: false,
    });
    const result = await adapter.getArchiveBaseline('Acme Widgets');

    // Then — the baseline round-trips intact
    expect(result).toEqual({ locationArchived: true, closed: false });
  });

  it('returns null for a project with no stored archive baseline', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an unknown project is read
    const result = await adapter.getArchiveBaseline('Other Project');

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('keeps archive baselines distinct from the other records', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a baseline is written alongside a project update
    await adapter.setArchiveBaseline('Acme Widgets', {
      locationArchived: false,
      closed: true,
    });
    await adapter.setLastProjectUpdate('Acme Widgets', '2026-09-18T10:00:00Z');

    // Then — each lives under its own namespaced key
    expect(snapshot()).toEqual({
      'archiveBaseline.Acme Widgets': {
        locationArchived: false,
        closed: true,
      },
      'projectUpdate.Acme Widgets': '2026-09-18T10:00:00Z',
    });
  });

  it('round-trips a watch state under a namespaced key', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a watch state is set then read back
    await adapter.setWatchState('Acme Widgets', {
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });
    const result = await adapter.getWatchState('Acme Widgets');

    // Then — the watch state round-trips intact
    expect(result).toEqual({
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });
  });

  it('returns an empty watch state for a project never watched', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an unknown project is read
    const result = await adapter.getWatchState('Other Project');

    // Then — the empty watch state is returned, so the first read adopts
    expect(result).toEqual({ etag: null, cursor: null });
  });

  it('keeps watch states distinct from the other records', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a watch state is written alongside a baseline
    await adapter.setWatchState('Acme Widgets', {
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });
    await adapter.setArchiveBaseline('Acme Widgets', {
      locationArchived: true,
      closed: true,
    });

    // Then — each lives under its own namespaced key
    expect(snapshot()).toEqual({
      'watch.Acme Widgets': {
        etag: 'W/"abc"',
        cursor: '2026-09-18T10:00:00Z',
      },
      'archiveBaseline.Acme Widgets': {
        locationArchived: true,
        closed: true,
      },
    });
  });

  it('round-trips a Todoist project state under a namespaced key', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a Todoist project state is set then read back
    await adapter.setTodoistProjectState('Acme Widgets', {
      sections: { Unshaped: 'S1', Shipped: 'S2' },
      lastCompletedPoll: '2026-09-18T10:00:00Z',
    });
    const result = await adapter.getTodoistProjectState('Acme Widgets');

    // Then — the state round-trips intact
    expect(result).toEqual({
      sections: { Unshaped: 'S1', Shipped: 'S2' },
      lastCompletedPoll: '2026-09-18T10:00:00Z',
    });
  });

  it('returns null for a project with no Todoist state', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an unknown project is read
    const result = await adapter.getTodoistProjectState('Other Project');

    // Then — null is returned, so the caller creates the record
    expect(result).toBeNull();
  });

  it('keeps Todoist project states distinct from the other records', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a Todoist project state is written alongside a watch state
    await adapter.setTodoistProjectState('Acme Widgets', {
      sections: {},
      lastCompletedPoll: '2026-09-18T10:00:00Z',
    });
    await adapter.setWatchState('Acme Widgets', {
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });

    // Then — each lives under its own namespaced key
    expect(snapshot()).toEqual({
      'todoistProject.Acme Widgets': {
        sections: {},
        lastCompletedPoll: '2026-09-18T10:00:00Z',
      },
      'watch.Acme Widgets': {
        etag: 'W/"abc"',
        cursor: '2026-09-18T10:00:00Z',
      },
    });
  });

  it('round-trips a Todoist item state under a namespaced key', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a Todoist item state is set then read back
    await adapter.setTodoistState('Projecten/Acme Widgets/taken/42-bug.md', {
      todoistId: 'T1',
      notePath: 'Projecten/Acme Widgets/taken/42-bug.md',
      lastSyncedHash: 'abc123',
      lastSyncedCompleted: false,
    });
    const result = await adapter.getTodoistState(
      'Projecten/Acme Widgets/taken/42-bug.md',
    );

    // Then — the state round-trips intact under its own key
    expect(result).toEqual({
      todoistId: 'T1',
      notePath: 'Projecten/Acme Widgets/taken/42-bug.md',
      lastSyncedHash: 'abc123',
      lastSyncedCompleted: false,
    });
    expect(snapshot()).toEqual({
      'todoistItem.Projecten/Acme Widgets/taken/42-bug.md': {
        todoistId: 'T1',
        notePath: 'Projecten/Acme Widgets/taken/42-bug.md',
        lastSyncedHash: 'abc123',
        lastSyncedCompleted: false,
      },
    });
  });

  it('returns null for a note with no Todoist item state', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an unknown note path is read
    const result = await adapter.getTodoistState('Projecten/Other/taken/x.md');

    // Then — null is returned, so the caller creates the twin
    expect(result).toBeNull();
  });

  it('lists every Todoist item state', async () => {
    // Given — two mirrored items
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setTodoistState('a.md', {
      todoistId: 'T1',
      notePath: 'a.md',
      lastSyncedHash: 'h1',
      lastSyncedCompleted: false,
    });
    await adapter.setTodoistState('b.md', {
      todoistId: 'T2',
      notePath: 'b.md',
      lastSyncedHash: 'h2',
      lastSyncedCompleted: true,
    });

    // When — the item states are listed
    const result = await adapter.listTodoistStates();

    // Then — both are returned
    expect(result).toEqual([
      {
        todoistId: 'T1',
        notePath: 'a.md',
        lastSyncedHash: 'h1',
        lastSyncedCompleted: false,
      },
      {
        todoistId: 'T2',
        notePath: 'b.md',
        lastSyncedHash: 'h2',
        lastSyncedCompleted: true,
      },
    ]);
  });

  it('round-trips the per-field bases when present', async () => {
    // Given — an item carrying the t5 per-field bases
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setTodoistState('a.md', {
      todoistId: 'T1',
      notePath: 'a.md',
      lastSyncedHash: 'h1',
      lastSyncedCompleted: false,
      lastSyncedContent: 'Buy milk',
      lastSyncedLane: 'Building',
      lastSyncedParent: null,
    });

    // When — the item state is read back
    const result = await adapter.getTodoistState('a.md');

    // Then — the bases survive, including an explicit null lane/parent
    expect(result).toEqual({
      todoistId: 'T1',
      notePath: 'a.md',
      lastSyncedHash: 'h1',
      lastSyncedCompleted: false,
      lastSyncedContent: 'Buy milk',
      lastSyncedLane: 'Building',
      lastSyncedParent: null,
    });
  });

  it('re-keys an item to its new note path, evicting the old record', async () => {
    // Given — an item anchored at one path
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setTodoistState('old.md', {
      todoistId: 'T1',
      notePath: 'old.md',
      lastSyncedHash: 'h1',
      lastSyncedCompleted: false,
    });

    // When — the same item is set at a new path (a rename)
    await adapter.setTodoistState('new.md', {
      todoistId: 'T1',
      notePath: 'new.md',
      lastSyncedHash: 'h1',
      lastSyncedCompleted: false,
    });

    // Then — only the new key survives; the old anchor is gone
    expect(snapshot()).toEqual({
      'todoistItem.new.md': {
        todoistId: 'T1',
        notePath: 'new.md',
        lastSyncedHash: 'h1',
        lastSyncedCompleted: false,
      },
    });
    expect(await adapter.getTodoistState('old.md')).toBeNull();
  });
});
