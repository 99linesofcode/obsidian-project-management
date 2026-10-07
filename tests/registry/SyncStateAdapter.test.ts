import { describe, expect, it } from 'vitest';
import {
  SYNC_STATE_KEY,
  SyncStateAdapter,
  type SyncStateStorage,
} from '../../src/registry/SyncStateAdapter.js';
import { entityRecord } from '../helpers/records.js';
import {
  runSyncStateConformance,
  type SyncStateConformanceHarness,
} from '../helpers/syncStateConformance.js';

// A fake storage at the boundary: an in-memory map behind load/save, so the
// adapter's keying, migration and index maintenance is what's under test. The
// backup counter records the rolling-backup requests.
function fakeStorage(initial: Record<string, unknown> = {}) {
  let data: Record<string, unknown> = initial;
  let backups = 0;
  let saves = 0;
  const storage: SyncStateStorage = {
    async load() {
      return data;
    },
    async save(next: unknown) {
      data = next as Record<string, unknown>;
      saves += 1;
    },
    async backup() {
      backups += 1;
    },
  };
  return {
    storage,
    snapshot: () => data,
    backups: () => backups,
    saves: () => saves,
  };
}

// The container under the top-level key, as the adapter persists it.
function container(snapshot: Record<string, unknown>): Record<string, unknown> {
  return snapshot[SYNC_STATE_KEY] as Record<string, unknown>;
}

// The project node inside the container.
function project(
  snapshot: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const projects = container(snapshot)['projects'] as Record<string, unknown>;
  return projects[name] as Record<string, unknown>;
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

describe('REG-1 — the registry holds exactly the justified entities', () => {
  it('round-trips an entity under projects.<name>.entities', async () => {
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const record = entityRecord({ id: 'entity-1', notePath });

    await adapter.setEntity(record);
    const result = await adapter.getEntity('entity-1');

    expect(result).toEqual(record);
    expect(container(snapshot())['version']).toBe(3);
    expect(project(snapshot(), 'Acme Widgets')['entities']).toEqual({
      'entity-1': { notePath },
    });
  });

  it('round-trips a per-surface project cursor', async () => {
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    const before = await adapter.getProjectCursor('todoist');
    await adapter.setProjectCursor('todoist', '2026-10-05T10:00:00Z');
    const after = await adapter.getProjectCursor('todoist');

    expect(before).toBeNull();
    expect(after).toBe('2026-10-05T10:00:00Z');
    expect(container(snapshot())['projectCursors']).toEqual({
      todoist: '2026-10-05T10:00:00Z',
    });
  });

  it('returns null for an unknown entity id', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    expect(await adapter.getEntity('missing')).toBeNull();
  });

  it('finds an entity by its note path', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const record = entityRecord({ id: 'entity-1', notePath });
    await adapter.setEntity(record);
    expect(await adapter.findByNotePath(notePath)).toEqual(record);
  });

  it('returns null when no entity matches the note path', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(entityRecord({ id: 'entity-1', notePath }));
    expect(await adapter.findByNotePath('Projecten/Other/x.md')).toBeNull();
  });

  it('finds a mirror item by a github handle and by a todoist handle', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(entityRecord({ id: 'entity-1', notePath }));
    await adapter.setMirrorItem('Acme Widgets', 'github', url, {
      entityId: 'entity-1',
      base: null,
    });
    await adapter.setMirrorItem('Acme Widgets', 'todoist', 'T1', {
      entityId: 'entity-1',
      base: null,
    });

    const byGithub = await adapter.findMirrorItem('github', url);
    const byTodoist = await adapter.findMirrorItem('todoist', 'T1');

    expect(byGithub).toEqual({ entityId: 'entity-1', base: null });
    expect(byTodoist).toEqual({ entityId: 'entity-1', base: null });
  });

  it('returns null for an unknown mirror handle', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(entityRecord({ id: 'entity-1', notePath }));
    await adapter.setMirrorItem('Acme Widgets', 'github', url, {
      entityId: 'entity-1',
      base: null,
    });
    expect(
      await adapter.findMirrorItem('github', 'https://github.com/x/1'),
    ).toBeNull();
  });

  it('lists a project port items and removes one', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(entityRecord({ id: 'entity-1', notePath }));
    await adapter.setMirrorItem('Acme Widgets', 'github', url, {
      entityId: 'entity-1',
      base: null,
    });

    expect(await adapter.listMirrorItems('Acme Widgets', 'github')).toEqual([
      { handle: url, item: { entityId: 'entity-1', base: null } },
    ]);

    await adapter.removeMirrorItem('Acme Widgets', 'github', url);
    expect(await adapter.listMirrorItems('Acme Widgets', 'github')).toEqual([]);
    expect(await adapter.findMirrorItem('github', url)).toBeNull();
  });

  it('removes an entity and sweeps its mirror items from every port', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(entityRecord({ id: 'entity-1', notePath }));
    await adapter.setMirrorItem('Acme Widgets', 'github', url, {
      entityId: 'entity-1',
      base: null,
    });
    await adapter.setMirrorItem('Acme Widgets', 'todoist', 'T1', {
      entityId: 'entity-1',
      base: null,
    });

    await adapter.removeEntity('entity-1');

    expect(await adapter.getEntity('entity-1')).toBeNull();
    expect(await adapter.findByNotePath(notePath)).toBeNull();
    expect(await adapter.findMirrorItem('github', url)).toBeNull();
    expect(await adapter.findMirrorItem('todoist', 'T1')).toBeNull();
  });

  it('lists entities scoped to their project', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(
      entityRecord({ id: 'a', notePath: 'Projecten/Acme Widgets/taken/a.md' }),
    );
    await adapter.setEntity(
      entityRecord({ id: 'b', notePath: 'Projecten/Other/taken/b.md' }),
    );

    expect(
      (await adapter.listEntities('Acme Widgets')).map((r) => r.id),
    ).toEqual(['a']);
    expect((await adapter.listEntities('Other')).map((r) => r.id)).toEqual([
      'b',
    ]);
    expect(await adapter.listEntities('Missing')).toEqual([]);
  });

  it('moves the note-path index when an entity is re-keyed to a new path', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(
      entityRecord({
        id: 'entity-1',
        notePath: 'Projecten/Acme Widgets/taken/old.md',
      }),
    );
    await adapter.setEntity(
      entityRecord({
        id: 'entity-1',
        notePath: 'Projecten/Acme Widgets/taken/new.md',
      }),
    );

    expect(
      await adapter.findByNotePath('Projecten/Acme Widgets/taken/old.md'),
    ).toBeNull();
    expect(
      (await adapter.findByNotePath('Projecten/Acme Widgets/taken/new.md'))?.id,
    ).toBe('entity-1');
  });

  it('re-points a claimed handle without evicting the older entity', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(
      entityRecord({
        id: 'older',
        notePath: 'Projecten/Acme Widgets/taken/older.md',
      }),
    );
    await adapter.setMirrorItem('Acme Widgets', 'github', url, {
      entityId: 'older',
      base: null,
    });
    await adapter.setMirrorItem('Acme Widgets', 'todoist', 'T-older', {
      entityId: 'older',
      base: null,
    });

    await adapter.setEntity(
      entityRecord({
        id: 'newer',
        notePath: 'Projecten/Acme Widgets/taken/newer.md',
      }),
    );
    await adapter.setMirrorItem('Acme Widgets', 'github', url, {
      entityId: 'newer',
      base: null,
    });

    expect((await adapter.findMirrorItem('github', url))?.entityId).toBe(
      'newer',
    );
    expect(await adapter.getEntity('older')).not.toBeNull();
    expect((await adapter.findMirrorItem('todoist', 'T-older'))?.entityId).toBe(
      'older',
    );
  });

  it('round-trips the project-level namespaces nested under the project', async () => {
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await adapter.setIdentity('Acme Widgets', 'github', identity);
    await adapter.setLastProjectUpdate('Acme Widgets', '2026-09-18T10:00:00Z');
    await adapter.setArchiveBaseline('Acme Widgets', {
      locationArchived: true,
      closed: false,
      archivedAt: '2026-09-18T09:00:00Z',
    });
    await adapter.setWatchState('Acme Widgets', {
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });

    expect(await adapter.getIdentity('Acme Widgets', 'github')).toEqual(
      identity,
    );
    expect(await adapter.getLastProjectUpdate('Acme Widgets')).toBe(
      '2026-09-18T10:00:00Z',
    );
    expect(await adapter.getArchiveBaseline('Acme Widgets')).toEqual({
      locationArchived: true,
      closed: false,
      archivedAt: '2026-09-18T09:00:00Z',
    });
    expect(await adapter.getWatchState('Acme Widgets')).toEqual({
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });

    const acme = project(snapshot(), 'Acme Widgets');
    expect(acme['identities']).toEqual({ github: identity });
    expect(acme['lastProjectUpdate']).toBe('2026-09-18T10:00:00Z');
    expect(acme['archive']).toEqual({
      locationArchived: true,
      closed: false,
      archivedAt: '2026-09-18T09:00:00Z',
    });
    expect(acme['watch']).toEqual({
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });
  });

  it('round-trips a port state and returns null for an unknown port', async () => {
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const state = {
      provider: 'todoist',
      project: 'P1',
      lastPoll: '2026-09-18T10:00:00Z',
      lanes: { Unshaped: 'S1' },
    };

    await adapter.setPortState('Acme Widgets', 'todoist', state);

    expect(await adapter.getPortState('Acme Widgets', 'todoist')).toEqual(
      state,
    );
    expect(await adapter.getPortState('Acme Widgets', 'github')).toBeNull();
    const ports = project(snapshot(), 'Acme Widgets')['ports'] as Record<
      string,
      unknown
    >;
    expect(ports['todoist']).toEqual(state);
  });

  it('keys two connections of the same tool independently', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await adapter.setPortState('Acme Widgets', 'todoist-work', {
      provider: 'todoist',
      project: 'P1',
      lastPoll: '2026-09-18T10:00:00Z',
      lanes: { Unshaped: 'S1' },
    });
    await adapter.setPortState('Acme Widgets', 'todoist-personal', {
      provider: 'todoist',
      project: 'P2',
      lastPoll: '2026-09-18T11:00:00Z',
      lanes: { Unshaped: 'S9' },
    });

    expect(await adapter.getPortState('Acme Widgets', 'todoist-work')).toEqual({
      provider: 'todoist',
      project: 'P1',
      lastPoll: '2026-09-18T10:00:00Z',
      lanes: { Unshaped: 'S1' },
    });
    expect(
      await adapter.getPortState('Acme Widgets', 'todoist-personal'),
    ).toEqual({
      provider: 'todoist',
      project: 'P2',
      lastPoll: '2026-09-18T11:00:00Z',
      lanes: { Unshaped: 'S9' },
    });
  });

  it('re-keys a port to a new slug in one write, moving its items', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity({ id: 'uuid-1', notePath });
    await adapter.setPortState('Acme Widgets', 'todoist', {
      provider: 'todoist',
      project: 'P1',
      lastPoll: '2026-09-18T10:00:00Z',
      lanes: {},
    });
    await adapter.setMirrorItem('Acme Widgets', 'todoist', 'T1', {
      entityId: 'uuid-1',
      base: null,
    });

    await adapter.rekeyPortState('Acme Widgets', 'todoist', 'todoist-work');

    expect(await adapter.getPortState('Acme Widgets', 'todoist')).toBeNull();
    expect(await adapter.getPortState('Acme Widgets', 'todoist-work')).toEqual({
      provider: 'todoist',
      project: 'P1',
      lastPoll: '2026-09-18T10:00:00Z',
      lanes: {},
    });
    expect(await adapter.findMirrorItem('todoist-work', 'T1')).not.toBeNull();
    expect(await adapter.findMirrorItem('todoist', 'T1')).toBeNull();
  });

  it('re-keys one project without disturbing another project sharing the slug', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity({
      id: 'uuid-a',
      notePath: 'Projecten/A/taken/a.md',
    });
    await adapter.setEntity({
      id: 'uuid-b',
      notePath: 'Projecten/B/taken/b.md',
    });
    await adapter.setMirrorItem('A', 'todoist', 'T-a', {
      entityId: 'uuid-a',
      base: null,
    });
    await adapter.setMirrorItem('B', 'todoist', 'T-b', {
      entityId: 'uuid-b',
      base: null,
    });

    await adapter.rekeyPortState('A', 'todoist', 'work');

    expect((await adapter.findMirrorItem('work', 'T-a'))?.entityId).toBe(
      'uuid-a',
    );
    expect(await adapter.findMirrorItem('todoist', 'T-a')).toBeNull();
    // B's handle under the same slug must survive A's rename.
    expect((await adapter.findMirrorItem('todoist', 'T-b'))?.entityId).toBe(
      'uuid-b',
    );
  });
});

describe('SyncStateAdapter write serialisation', () => {
  it('serialises interleaved writers so no update is lost', async () => {
    let disk: Record<string, unknown> = {};
    const storage: SyncStateStorage = {
      async load() {
        return JSON.parse(JSON.stringify(disk)) as Record<string, unknown>;
      },
      async save(next: unknown) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        disk = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
      },
    };
    const adapter = new SyncStateAdapter(storage);

    await Promise.all([
      adapter.setEntity(
        entityRecord({ id: 'e1', notePath: 'Projecten/A/taken/1.md' }),
      ),
      adapter.setEntity(
        entityRecord({ id: 'e2', notePath: 'Projecten/A/taken/2.md' }),
      ),
    ]);

    const ids = (await adapter.listEntities('A')).map((r) => r.id).sort();
    expect(ids).toEqual(['e1', 'e2']);
  });

  it('asks for a rolling backup before overwriting, throttled', async () => {
    const { storage, backups } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await adapter.setEntity(
      entityRecord({ id: 'e1', notePath: 'Projecten/A/taken/1.md' }),
    );
    await adapter.setEntity(
      entityRecord({ id: 'e2', notePath: 'Projecten/A/taken/2.md' }),
    );

    expect(backups()).toBe(1);
  });
});

// F4 — a cursor that does not move is not a registry write. The capture runs
// every tick, so persisting an unchanged watermark would dirty the store on a
// quiet pass (SYNC-8).
describe('F4 — a quiet tick writes nothing', () => {
  it('does not persist a project cursor set to its current value', async () => {
    const { storage, saves } = fakeStorage({
      [SYNC_STATE_KEY]: { version: 3, projectCursors: { todoist: 'T' } },
    });
    const adapter = new SyncStateAdapter(storage);
    await adapter.getProjectCursor('todoist');
    const before = saves();

    await adapter.setProjectCursor('todoist', 'T');
    expect(saves()).toBe(before);

    await adapter.setProjectCursor('todoist', 'T2');
    expect(saves()).toBe(before + 1);
    expect(await adapter.getProjectCursor('todoist')).toBe('T2');
  });
});

// F6 — a container written by a newer plugin version must never be rewritten in
// this version's shape. Reads serve it; every mutating port method refuses.
describe('F6 — a container from a newer plugin version is read-only', () => {
  it('serves reads but refuses every mutation', async () => {
    const { storage, snapshot } = fakeStorage({
      [SYNC_STATE_KEY]: {
        version: 4,
        projects: { 'Acme Widgets': { entities: { e1: { notePath } } } },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    expect(await adapter.getEntity('e1')).toEqual({ id: 'e1', notePath });
    expect(await adapter.listEntities('Acme Widgets')).toHaveLength(1);

    await expect(
      adapter.setEntity(
        entityRecord({
          id: 'e2',
          notePath: 'Projecten/Acme Widgets/taken/2.md',
        }),
      ),
    ).rejects.toThrow(/newer plugin version/);
    await expect(
      adapter.setIdentity('Acme Widgets', 'github', identity),
    ).rejects.toThrow(/refusing to mutate/);

    expect(container(snapshot())['version']).toBe(4);
    expect(project(snapshot(), 'Acme Widgets')['entities']).toEqual({
      e1: { notePath },
    });
  });
});

// F7 — settings save and registry persist share one serialization chain, so a
// concurrent save can never revert a registry write (REG-3). Without the chain
// the two load-modify-save cycles interleave and the later save wins with a
// stale root.
describe('F7 — settings and registry writes share one chain', () => {
  it('serialises a root mutation against a registry write', async () => {
    let disk: Record<string, unknown> = {};
    const storage: SyncStateStorage = {
      async load() {
        return structuredClone(disk);
      },
      async save(next: unknown) {
        // A delayed save makes an unserialised interleave lose a write.
        await new Promise((resolve) => setTimeout(resolve, 5));
        disk = structuredClone(next) as Record<string, unknown>;
      },
    };
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(entityRecord({ id: 'e1', notePath }));

    await Promise.all([
      adapter.setEntity(
        entityRecord({
          id: 'e2',
          notePath: 'Projecten/Acme Widgets/taken/2.md',
        }),
      ),
      adapter.mutateRoot((root) => ({ ...root, githubToken: 'tok' })),
    ]);

    expect(await adapter.getEntity('e2')).not.toBeNull();
    expect(disk['githubToken']).toBe('tok');
    const synced = disk[SYNC_STATE_KEY] as {
      projects: Record<string, { entities: Record<string, unknown> }>;
    };
    expect(synced.projects['Acme Widgets']!.entities['e1']).toBeDefined();
    expect(synced.projects['Acme Widgets']!.entities['e2']).toBeDefined();
  });
});

// The shared port contract, run against the REAL adapter. The exact same suite
// runs against FakeSyncState (tests/helpers/fakeSyncState.test.ts), so the fake
// and the adapter can never drift apart again.
const conformanceHarness: SyncStateConformanceHarness = {
  create(options) {
    const raw: Record<string, unknown> = {};
    if (options?.pendingProjects?.length) {
      const projects: Record<string, unknown> = {};
      for (const name of options.pendingProjects) {
        projects[name] = { fullScanPending: true };
      }
      raw[SYNC_STATE_KEY] = { version: 3, projects };
    }
    const { storage } = fakeStorage(raw);
    return new SyncStateAdapter(storage);
  },
};

runSyncStateConformance('SyncStateAdapter', conformanceHarness);
