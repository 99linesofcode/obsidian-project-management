import { describe, expect, it } from 'vitest';
import {
  SyncStateAdapter,
  migrateLegacyState,
  type SyncStateStorage,
} from '../../../src/Infrastructure/Obsidian/SyncStateAdapter.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

// A fake storage at the boundary: an in-memory map behind load/save, so the
// adapter's keying, migration and round-tripping is what's under test.
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

const task: TaskData = taskRecord({
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
  title: 'Fix the Bug!',
  body: 'abc123',
  status: 'Shipped',
  completed: true,
  updatedAt: '2026-09-18T10:00:00Z',
});

const identity = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
};

describe('SyncStateAdapter', () => {
  it('round-trips a canonical task record under the namespaced container', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a canonical task is set then read back
    await adapter.set(task);
    const result = await adapter.get(task.url);

    // Then — the record round-trips intact, under the syncState container
    expect(result).toEqual(task);
    expect(snapshot()).toEqual({ syncState: { [`status.${task.url}`]: task } });
  });

  it('preserves a real lane name across a reload', async () => {
    // Given — a record in a lane that is neither 'done' nor 'open'
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(task);

    // When — a fresh adapter reads the same storage (a plugin reload)
    const reloaded = new SyncStateAdapter(storage);
    const result = await reloaded.get(task.url);

    // Then — the lane survives verbatim (the old adapter coerced it)
    expect(result?.status).toBe('Shipped');
  });

  it('returns null for an unknown task url', async () => {
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

  it('finds a task record by its note path', async () => {
    // Given — a stored record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(task);

    // When — the record is looked up by its note path
    const result = await adapter.findByNotePath(task.notePath);

    // Then — the record is returned
    expect(result).toEqual(task);
  });

  it('returns null when no record matches the note path', async () => {
    // Given — a stored record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(task);

    // When — an unknown note path is looked up
    const result = await adapter.findByNotePath(
      'Projecten/Other/taken/99-unknown.md',
    );

    // Then — null is returned
    expect(result).toBeNull();
  });

  it('removes a task record by its url', async () => {
    // Given — a stored record
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.set(task);

    // When — the record is removed
    await adapter.remove(task.url);

    // Then — the record is gone
    expect(await adapter.get(task.url)).toBeNull();
  });

  it('lists every stored task record', async () => {
    // Given — two stored records
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const other = taskRecord({
      url: task.url.replace('42', '43'),
      remoteId: 43,
    });
    await adapter.set(task);
    await adapter.set(other);

    // When — all records are listed
    const result = await adapter.list();

    // Then — both records are returned
    expect(result).toEqual([task, other]);
  });

  it('lists an empty array when no task records exist', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — all records are listed
    const result = await adapter.list();

    // Then — an empty array is returned
    expect(result).toEqual([]);
  });

  it('round-trips a project identity under the container', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an identity is set then read back
    await adapter.setIdentity('Acme Widgets', identity);
    const result = await adapter.getIdentity('Acme Widgets');

    // Then — the identity round-trips intact
    expect(result).toEqual(identity);
  });

  it('round-trips a project update under the container', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — an update is set then read back
    await adapter.setLastProjectUpdate('Acme Widgets', '2026-09-18T10:00:00Z');

    // Then — the update round-trips intact
    expect(await adapter.getLastProjectUpdate('Acme Widgets')).toBe(
      '2026-09-18T10:00:00Z',
    );
  });

  it('round-trips an archive baseline under the container', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a baseline is set then read back
    await adapter.setArchiveBaseline('Acme Widgets', {
      locationArchived: true,
      closed: false,
    });

    // Then — the baseline round-trips intact
    expect(await adapter.getArchiveBaseline('Acme Widgets')).toEqual({
      locationArchived: true,
      closed: false,
    });
  });

  it('round-trips a watch state under the container', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a watch state is set then read back
    await adapter.setWatchState('Acme Widgets', {
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });

    // Then — the watch state round-trips intact
    expect(await adapter.getWatchState('Acme Widgets')).toEqual({
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

  it('round-trips a Todoist project state under the container', async () => {
    // Given — an empty storage
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    // When — a Todoist project state is set then read back
    await adapter.setTodoistProjectState('Acme Widgets', {
      sections: { Unshaped: 'S1', Shipped: 'S2' },
      lastCompletedPoll: '2026-09-18T10:00:00Z',
    });

    // Then — the state round-trips intact
    expect(await adapter.getTodoistProjectState('Acme Widgets')).toEqual({
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

  it('round-trips a canonical Todoist item under the container', async () => {
    // Given — an empty storage
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const item = taskRecord({
      url: '',
      remoteId: 0,
      todoistId: 'T1',
      notePath: 'Projecten/Acme Widgets/taken/42-bug.md',
      title: 'Fix the bug',
      status: 'Building',
    });

    // When — the item is set then read back
    await adapter.setTodoistState(item.notePath, item);
    const result = await adapter.getTodoistState(item.notePath);

    // Then — the state round-trips intact under its own key
    expect(result).toEqual(item);
    expect(snapshot()).toEqual({
      syncState: { [`todoistItem.${item.notePath}`]: item },
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
    const first = taskRecord({ todoistId: 'T1', notePath: 'a.md', title: 'A' });
    const second = taskRecord({
      todoistId: 'T2',
      notePath: 'b.md',
      title: 'B',
      completed: true,
    });
    await adapter.setTodoistState('a.md', first);
    await adapter.setTodoistState('b.md', second);

    // When — the item states are listed
    const result = await adapter.listTodoistStates();

    // Then — both are returned
    expect(result).toEqual([first, second]);
  });

  it('re-keys an item to its new note path, evicting the old record', async () => {
    // Given — an item anchored at one path
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setTodoistState(
      'old.md',
      taskRecord({ todoistId: 'T1', notePath: 'old.md', title: 'A' }),
    );

    // When — the same item is set at a new path (a rename)
    await adapter.setTodoistState(
      'new.md',
      taskRecord({ todoistId: 'T1', notePath: 'new.md', title: 'A' }),
    );

    // Then — only the new key survives; the old anchor is gone
    expect(snapshot()).toEqual({
      syncState: {
        'todoistItem.new.md': taskRecord({
          todoistId: 'T1',
          notePath: 'new.md',
          title: 'A',
        }),
      },
    });
    expect(await adapter.getTodoistState('old.md')).toBeNull();
  });

  it('removes a Todoist item state by its note path', async () => {
    // Given — a stored Todoist item state
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setTodoistState(
      'a.md',
      taskRecord({ todoistId: 'T1', notePath: 'a.md' }),
    );

    // When — the record is removed
    await adapter.removeTodoistState('a.md');

    // Then — it is gone outright, with no empty record left behind
    expect(await adapter.getTodoistState('a.md')).toBeNull();
    expect(snapshot()).toEqual({ syncState: {} });
  });

  it('migrates legacy flat keys into the syncState container', async () => {
    // Given — the pre-t5 shape: records flat at the data.json root, settings
    // alongside them
    const { storage, snapshot } = fakeStorage({
      githubToken: 'secret',
      'status.https://github.com/acme/widgets/issues/42': {
        url: 'https://github.com/acme/widgets/issues/42',
        remoteId: 42,
        notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
        lastSyncedBodyHash: 'abc123',
        lastSyncedRemoteUpdatedAt: '2026-09-18T10:00:00Z',
        lastSyncedStatus: 'Shipped',
        lastSyncedTitle: 'Fix the Bug!',
      },
      'todoistItem.Projecten/Acme Widgets/taken/42-fix-the-bug.md': {
        todoistId: 'T1',
        notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
        lastSyncedHash: 'h1',
        lastSyncedCompleted: false,
        lastSyncedContent: 'Fix the bug',
        lastSyncedLane: 'Building',
        lastSyncedParent: null,
      },
      'identity.Acme Widgets': identity,
      'projectUpdate.Acme Widgets': '2026-09-18T10:00:00Z',
      'archiveBaseline.Acme Widgets': { locationArchived: false, closed: true },
      'watch.Acme Widgets': { etag: null, cursor: null },
      'todoistProject.Acme Widgets': { sections: {}, lastCompletedPoll: '' },
    });
    const adapter = new SyncStateAdapter(storage);

    // When — the adapter reads (and migrates) the store
    const task = await adapter.get('https://github.com/acme/widgets/issues/42');
    const item = await adapter.getTodoistState(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );

    // Then — every record moved under syncState, the settings key did not, and
    // the legacy shapes load as canonical records with their lanes intact
    const data = snapshot();
    expect(Object.keys(data).sort()).toEqual(['githubToken', 'syncState']);
    expect(data['githubToken']).toBe('secret');
    const root = data['syncState'] as Record<string, unknown>;
    expect(Object.keys(root).sort()).toEqual([
      'archiveBaseline.Acme Widgets',
      'identity.Acme Widgets',
      'projectUpdate.Acme Widgets',
      'status.https://github.com/acme/widgets/issues/42',
      'todoistItem.Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'todoistProject.Acme Widgets',
      'watch.Acme Widgets',
    ]);
    expect(task).toEqual(
      taskRecord({
        url: 'https://github.com/acme/widgets/issues/42',
        remoteId: 42,
        notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
        title: 'Fix the Bug!',
        body: 'abc123',
        status: 'Shipped',
        updatedAt: '2026-09-18T10:00:00Z',
      }),
    );
    expect(item).toEqual(
      taskRecord({
        url: '',
        remoteId: 0,
        todoistId: 'T1',
        notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
        title: 'Fix the bug',
        status: 'Building',
      }),
    );
  });

  it('is idempotent: a second load does not re-migrate', async () => {
    // Given — data already under the container
    const { storage } = fakeStorage({ syncState: { 'status.a': task } });

    // When — the migration runs
    const changed = migrateLegacyState(await storage.load());

    // Then — it is a no-op
    expect(changed).toBe(false);
  });
});
