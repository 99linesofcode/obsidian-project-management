import { describe, expect, it } from 'vitest';
import {
  SYNC_STATE_KEY,
  SyncStateAdapter,
  migrateEntities,
  migrateLegacyState,
  type SyncStateStorage,
} from '../../../src/Infrastructure/Obsidian/SyncStateAdapter.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import { entityRecord, mirror, taskData } from '../../helpers/records.js';

// A fake storage at the boundary: an in-memory map behind load/save, so the
// adapter's keying, migration and index maintenance is what's under test.
function fakeStorage(initial: Record<string, unknown> = {}) {
  let data: Record<string, unknown> = initial;
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

// The container under the top-level key, as the adapter persists it.
function container(snapshot: Record<string, unknown>): Record<string, unknown> {
  return snapshot[SYNC_STATE_KEY] as Record<string, unknown>;
}

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

const identity = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
};

describe('SyncStateAdapter', () => {
  it('round-trips an entity record under the entities namespace', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const record = entityRecord({
      id: 'entity-1',
      notePath,
      mirrors: { github: mirror(url, taskData({ id: 'entity-1', notePath })) },
    });

    // When — the record is set then read back
    await adapter.set(record);
    const result = await adapter.get('entity-1');

    // Then — the record round-trips intact, under syncState.entities.<uuid>
    expect(result).toEqual(record);
    const root = container(snapshot());
    expect(Object.keys(root)).toEqual(['entities']);
    expect((root['entities'] as Record<string, unknown>)['entity-1']).toBe(
      record,
    );
  });

  it('returns null for an unknown entity id', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an unknown id is read
    const result = await adapter.get('missing');

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('finds an entity by its note path', async () => {
    // Given — a stored record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const record = entityRecord({ id: 'entity-1', notePath });
    await adapter.set(record);

    // When — the record is looked up by its note path
    const result = await adapter.findByNotePath(notePath);

    // Then — the record is returned
    expect(result).toEqual(record);
  });

  it('returns null when no entity matches the note path', async () => {
    // Given — a stored record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(entityRecord({ id: 'entity-1', notePath }));

    // When — an unknown note path is looked up
    const result = await adapter.findByNotePath('Projecten/Other/x.md');

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('finds an entity by a github handle and by a todoist handle', async () => {
    // Given — a task mirrored to both providers
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const record = entityRecord({
      id: 'entity-1',
      notePath,
      mirrors: { github: mirror(url), todoist: mirror('T1') },
    });
    await adapter.set(record);

    // When — the record is looked up per provider
    const byGithub = await adapter.findByMirror('github', url);
    const byTodoist = await adapter.findByMirror('todoist', 'T1');

    // Then — both resolve to the one entity
    expect(byGithub).toEqual(record);
    expect(byTodoist).toEqual(record);
  });

  it('returns null for an unknown mirror handle', async () => {
    // Given — a stored record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(
      entityRecord({ id: 'entity-1', mirrors: { github: mirror(url) } }),
    );

    // When — an unknown handle is looked up
    const result = await adapter.findByMirror(
      'github',
      'https://github.com/x/1',
    );

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('removes an entity by its id', async () => {
    // Given — a stored record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(entityRecord({ id: 'entity-1', notePath }));

    // When — the record is removed
    await adapter.remove('entity-1');

    // Then — it is gone
    expect(await adapter.get('entity-1')).toBeNull();
  });

  it('lists every entity record and nothing when empty', async () => {
    // Given — an empty storage and then two records
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    expect(await adapter.list()).toEqual([]);

    const first = entityRecord({ id: 'a', notePath: 'a.md' });
    const second = entityRecord({ id: 'b', notePath: 'b.md' });
    await adapter.set(first);
    await adapter.set(second);

    // When — all records are listed
    const result = await adapter.list();

    // Then — both are returned
    expect(result).toEqual([first, second]);
  });

  it('updates the indexes on set and clears them on remove', async () => {
    // Given — a stored, mirrored record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(
      entityRecord({
        id: 'entity-1',
        notePath,
        mirrors: { github: mirror(url) },
      }),
    );

    // When — the record is removed
    await adapter.remove('entity-1');

    // Then — both indexes no longer resolve it
    expect(await adapter.findByNotePath(notePath)).toBeNull();
    expect(await adapter.findByMirror('github', url)).toBeNull();
  });

  it('moves the note-path index when a record is re-keyed to a new path', async () => {
    // Given — a record at one path
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(
      entityRecord({
        id: 'entity-1',
        notePath: 'old.md',
        mirrors: { github: mirror(url) },
      }),
    );

    // When — the same entity is set at a new path (a rename)
    await adapter.set(
      entityRecord({
        id: 'entity-1',
        notePath: 'new.md',
        mirrors: { github: mirror(url) },
      }),
    );

    // Then — only the new path resolves
    expect(await adapter.findByNotePath('old.md')).toBeNull();
    expect((await adapter.findByNotePath('new.md'))?.id).toBe('entity-1');
  });

  it('evicts the older record when two claim the same handle', async () => {
    // Given — two records claiming one github url
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const older = entityRecord({
      id: 'older',
      notePath: 'older.md',
      mirrors: { github: mirror(url) },
    });
    const newer = entityRecord({
      id: 'newer',
      notePath: 'newer.md',
      mirrors: { github: mirror(url) },
    });
    await adapter.set(older);

    // When — the second record claims the same handle
    await adapter.set(newer);

    // Then — the older loses it, with no stale anchor left behind
    expect(await adapter.get('older')).toBeNull();
    expect(await adapter.findByNotePath('older.md')).toBeNull();
    expect((await adapter.findByMirror('github', url))?.id).toBe('newer');
  });

  it('round-trips the project-level namespaces beside the registry', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — each project-level record is written
    await adapter.setIdentity('Acme Widgets', identity);
    await adapter.setLastProjectUpdate('Acme Widgets', '2026-09-18T10:00:00Z');
    await adapter.setArchiveBaseline('Acme Widgets', {
      locationArchived: true,
      closed: false,
    });
    await adapter.setWatchState('Acme Widgets', {
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });
    await adapter.setTodoistProjectState('Acme Widgets', {
      sections: { Unshaped: 'S1' },
      lastCompletedPoll: '2026-09-18T10:00:00Z',
    });

    // Then — every one round-trips intact
    expect(await adapter.getIdentity('Acme Widgets')).toEqual(identity);
    expect(await adapter.getLastProjectUpdate('Acme Widgets')).toBe(
      '2026-09-18T10:00:00Z',
    );
    expect(await adapter.getArchiveBaseline('Acme Widgets')).toEqual({
      locationArchived: true,
      closed: false,
    });
    expect(await adapter.getWatchState('Acme Widgets')).toEqual({
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });
    expect(await adapter.getTodoistProjectState('Acme Widgets')).toEqual({
      sections: { Unshaped: 'S1' },
      lastCompletedPoll: '2026-09-18T10:00:00Z',
    });
  });
});

describe('SyncStateAdapter migration', () => {
  it('migrates a pre-t5 status record into a github-mirrored entity', async () => {
    // Given — a legacy provider-shaped status record, flat under the container
    const { storage, snapshot } = fakeStorage({
      syncState: {
        [`status.${url}`]: {
          url,
          remoteId: 42,
          notePath,
          lastSyncedBodyHash: 'abc123',
          lastSyncedRemoteUpdatedAt: '2026-09-18T10:00:00Z',
          lastSyncedStatus: 'Shipped',
          lastSyncedTitle: 'Fix the Bug!',
        },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    // When — the adapter loads (and migrates) the store
    const records = await adapter.list();

    // Then — one entity with a github mirror; the body digest is not re-hashed
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.notePath).toBe(notePath);
    expect(Object.keys(record.mirrors)).toEqual(['github']);
    expect(record.mirrors['github']?.handle).toBe(url);
    expect(record.mirrors['github']?.base).toEqual(
      taskData({
        id: record.id,
        notePath,
        title: 'Fix the Bug!',
        body: 'abc123',
        status: 'Shipped',
        completedAt: null,
        updatedAt: '2026-09-18T10:00:00Z',
      }),
    );
    // And the legacy key is gone from the container
    expect(container(snapshot())[`status.${url}`]).toBeUndefined();
  });

  it('migrates a done status record to a non-null completedAt stamp', async () => {
    // Given — a legacy status record in the done lane
    const { storage } = fakeStorage({
      syncState: {
        [`status.${url}`]: {
          url,
          remoteId: 42,
          notePath,
          lastSyncedBodyHash: 'abc123',
          lastSyncedStatus: 'done',
          lastSyncedTitle: 'Fix the Bug!',
        },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    // When — the adapter loads the store
    const record = (await adapter.list())[0]!;

    // Then — done carries a non-null (but unknown) stamp, preserving the
    // invariant completedAt !== null iff done
    expect(record.mirrors['github']?.base?.completedAt).toBe('');
  });

  it('migrates a canonical status record without re-hashing its body', async () => {
    // Given — the old canonical TaskData shape, whose body already is a digest
    const { storage } = fakeStorage({
      syncState: {
        [`status.${url}`]: {
          url,
          remoteId: 42,
          nodeId: 'I_kwDOAAAA42',
          todoistId: '',
          notePath,
          title: 'Fix the Bug!',
          body: 'digest-already',
          status: 'Shipped',
          completed: true,
          parent: null,
          labels: [],
          updatedAt: '2026-09-18T10:00:00Z',
        },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    // When — the adapter loads the store
    const base = (await adapter.list())[0]!.mirrors['github']?.base;

    // Then — the body is kept verbatim and completed maps to a stamp
    expect(base?.body).toBe('digest-already');
    expect(base?.completedAt).toBe('');
    expect(base?.updatedAt).toBe('2026-09-18T10:00:00Z');
  });

  it('migrates a todoist-only record into a Todoist-mirrored entity', async () => {
    // Given — a to-do with no GitHub record, as a pre-t5 record
    const { storage } = fakeStorage({
      syncState: {
        [`todoistItem.${notePath}`]: {
          todoistId: 'T1',
          notePath,
          lastSyncedHash: 'h1',
          lastSyncedCompleted: false,
          lastSyncedContent: 'Fix the bug',
          lastSyncedLane: 'Building',
          lastSyncedParent: null,
        },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    // When — the adapter loads the store
    const records = await adapter.list();

    // Then — an entity exists with only a todoist mirror; the empty body became
    // a digest so the base is a proper diff view
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.notePath).toBe(notePath);
    expect(Object.keys(record.mirrors)).toEqual(['todoist']);
    expect(record.mirrors['todoist']?.handle).toBe('T1');
    expect(record.mirrors['todoist']?.base).toEqual(
      taskData({
        id: record.id,
        notePath,
        title: 'Fix the bug',
        body: hash(''),
        status: 'Building',
        completedAt: null,
        parent: null,
        updatedAt: null,
      }),
    );
  });

  it('carries a completed to-do and its parent across the migration', async () => {
    // Given — a completed to-do with a parent mirror id
    const { storage } = fakeStorage({
      syncState: {
        [`todoistItem.${notePath}`]: {
          todoistId: 'T1',
          notePath,
          lastSyncedCompleted: true,
          lastSyncedContent: 'Fix the bug',
          lastSyncedLane: 'Building',
          lastSyncedParent: 'TP1',
        },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    // When — the adapter loads the store
    const base = (await adapter.list())[0]!.mirrors['todoist']?.base;

    // Then — the completion stamp and parent survive
    expect(base?.completedAt).toBe('');
    expect(base?.parent).toBe('TP1');
  });

  it('merges a todoist record into the github entity at the same note path', async () => {
    // Given — both halves of one task, keyed differently
    const { storage, snapshot } = fakeStorage({
      syncState: {
        [`status.${url}`]: {
          url,
          remoteId: 42,
          notePath,
          lastSyncedBodyHash: 'abc123',
          lastSyncedStatus: 'Building',
          lastSyncedTitle: 'Fix the bug',
        },
        [`todoistItem.${notePath}`]: {
          todoistId: 'T1',
          notePath,
          lastSyncedContent: 'Fix the bug',
          lastSyncedLane: 'Building',
          lastSyncedCompleted: false,
          lastSyncedParent: null,
        },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    // When — the adapter loads the store
    const records = await adapter.list();

    // Then — one entity joins both halves, reachable from either index
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(Object.keys(record.mirrors).sort()).toEqual(['github', 'todoist']);
    expect((await adapter.findByMirror('github', url))?.id).toBe(record.id);
    expect((await adapter.findByMirror('todoist', 'T1'))?.id).toBe(record.id);
    expect(container(snapshot())[`todoistItem.${notePath}`]).toBeUndefined();
  });

  it('drops no data across a mixed store', async () => {
    // Given — two github tasks, one with a todoist twin, and one to-do only
    const otherUrl = url.replace('42', '43');
    const otherPath = notePath.replace('42', '43');
    const { storage } = fakeStorage({
      syncState: {
        [`status.${url}`]: {
          url,
          remoteId: 42,
          notePath,
          lastSyncedBodyHash: 'h42',
          lastSyncedStatus: 'Shipped',
          lastSyncedTitle: 'Task 42',
        },
        [`status.${otherUrl}`]: {
          url: otherUrl,
          remoteId: 43,
          notePath: otherPath,
          lastSyncedBodyHash: 'h43',
          lastSyncedStatus: 'Building',
          lastSyncedTitle: 'Task 43',
        },
        [`todoistItem.${notePath}`]: {
          todoistId: 'T1',
          notePath,
          lastSyncedContent: 'Task 42',
          lastSyncedLane: 'Shipped',
          lastSyncedCompleted: false,
          lastSyncedParent: null,
        },
        'todoistItem.Projecten/Acme Widgets/todos/only.md': {
          todoistId: 'T2',
          notePath: 'Projecten/Acme Widgets/todos/only.md',
          lastSyncedContent: 'Only todo',
          lastSyncedLane: null,
          lastSyncedCompleted: false,
          lastSyncedParent: null,
        },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    // When — the adapter loads the store
    const records = await adapter.list();

    // Then — three entities survive: both tasks and the to-do-only one
    expect(records).toHaveLength(3);
    expect(await adapter.findByMirror('github', url)).not.toBeNull();
    expect(await adapter.findByMirror('github', otherUrl)).not.toBeNull();
    expect(await adapter.findByMirror('todoist', 'T2')).not.toBeNull();
    expect(
      await adapter.findByNotePath('Projecten/Acme Widgets/todos/only.md'),
    ).not.toBeNull();
  });

  it('is idempotent: a second load does not re-migrate', async () => {
    // Given — a store already migrated once
    const { storage, snapshot } = fakeStorage({
      syncState: {
        [`status.${url}`]: {
          url,
          remoteId: 42,
          notePath,
          lastSyncedBodyHash: 'abc123',
          lastSyncedStatus: 'Shipped',
          lastSyncedTitle: 'Fix the bug',
        },
      },
    });
    const first = new SyncStateAdapter(storage);
    await first.list();

    // When — the migration runs again, directly and through a fresh adapter
    const changed = migrateEntities(container(snapshot()));
    const second = new SyncStateAdapter(storage);
    const records = await second.list();

    // Then — it is a no-op and the entity count is unchanged
    expect(changed).toBe(false);
    expect(records).toHaveLength(1);
    expect(container(snapshot())[`status.${url}`]).toBeUndefined();
  });

  it('migrates legacy flat root keys into the container, then into entities', async () => {
    // Given — the pre-t5 shape: records flat at the data.json root, settings
    // alongside them
    const { storage, snapshot } = fakeStorage({
      githubToken: 'secret',
      [`status.${url}`]: {
        url,
        remoteId: 42,
        notePath,
        lastSyncedBodyHash: 'abc123',
        lastSyncedStatus: 'Shipped',
        lastSyncedTitle: 'Fix the Bug!',
      },
      'identity.Acme Widgets': identity,
    });
    const adapter = new SyncStateAdapter(storage);

    // When — the adapter reads (and migrates) the store
    const records = await adapter.list();

    // Then — the settings key did not move, the identity namespace survives,
    // and the status record became an entity
    const data = snapshot();
    expect(Object.keys(data).sort()).toEqual(['githubToken', 'syncState']);
    expect(data['githubToken']).toBe('secret');
    expect(await adapter.getIdentity('Acme Widgets')).toEqual(identity);
    expect(records).toHaveLength(1);
    expect(container(data)[`status.${url}`]).toBeUndefined();
  });

  it('keeps migrateLegacyState a no-op once the container exists', async () => {
    // Given — data already under the container
    const { storage } = fakeStorage({ syncState: { 'identity.A': identity } });

    // When — the flat-root migration runs
    const changed = migrateLegacyState(await storage.load());

    // Then — it is a no-op
    expect(changed).toBe(false);
  });
});
