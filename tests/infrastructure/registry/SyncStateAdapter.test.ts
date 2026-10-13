import { describe, expect, it } from 'vitest';
import { Baseline } from '../../../src/core/domain/Baseline.js';
import {
  SYNC_STATE_KEY,
  SyncStateAdapter,
  type SyncStateStorage,
} from '../../../src/infrastructure/registry/SyncStateAdapter.js';
import { entityRecord } from '../../helpers/records.js';
import {
  runSyncStateConformance,
  type SyncStateConformanceHarness,
} from '../../helpers/syncStateConformance.js';

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

function container(snapshot: Record<string, unknown>): Record<string, unknown> {
  return snapshot[SYNC_STATE_KEY] as Record<string, unknown>;
}

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
  target: 'https://github.com/acme/widgets',
  targetHandle: 'R_kgDOAAAA',
  projectHandle: 'PVT_123',
  statusFieldHandle: 'PVTF_456',
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
    });
    await adapter.setMirrorItem('Acme Widgets', 'todoist', 'T1', {
      entityId: 'entity-1',
    });

    const byGithub = await adapter.findMirrorItem('github', url);
    const byTodoist = await adapter.findMirrorItem('todoist', 'T1');

    expect(byGithub).toEqual({ entityId: 'entity-1' });
    expect(byTodoist).toEqual({ entityId: 'entity-1' });
  });

  it('returns null for an unknown mirror handle', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(entityRecord({ id: 'entity-1', notePath }));
    await adapter.setMirrorItem('Acme Widgets', 'github', url, {
      entityId: 'entity-1',
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
    });

    expect(await adapter.listMirrorItems('Acme Widgets', 'github')).toEqual([
      { handle: url, item: { entityId: 'entity-1' } },
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
    });
    await adapter.setMirrorItem('Acme Widgets', 'todoist', 'T1', {
      entityId: 'entity-1',
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
    });
    await adapter.setMirrorItem('Acme Widgets', 'todoist', 'T-older', {
      entityId: 'older',
    });

    await adapter.setEntity(
      entityRecord({
        id: 'newer',
        notePath: 'Projecten/Acme Widgets/taken/newer.md',
      }),
    );
    await adapter.setMirrorItem('Acme Widgets', 'github', url, {
      entityId: 'newer',
    });

    expect((await adapter.findMirrorItem('github', url))?.entityId).toBe(
      'newer',
    );
    expect(await adapter.getEntity('older')).not.toBeNull();
    expect((await adapter.findMirrorItem('todoist', 'T-older'))?.entityId).toBe(
      'older',
    );
  });

  it('round-trips a connection identity under the project', async () => {
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await adapter.setIdentity('Acme Widgets', 'github', identity);

    expect(await adapter.getIdentity('Acme Widgets', 'github')).toEqual(
      identity,
    );

    const acme = project(snapshot(), 'Acme Widgets');
    expect(acme['identities']).toEqual({ github: identity });
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
    });
    await adapter.setMirrorItem('B', 'todoist', 'T-b', {
      entityId: 'uuid-b',
    });

    await adapter.rekeyPortState('A', 'todoist', 'work');

    expect((await adapter.findMirrorItem('work', 'T-a'))?.entityId).toBe(
      'uuid-a',
    );
    expect(await adapter.findMirrorItem('todoist', 'T-a')).toBeNull();
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

describe('F7 — settings and registry writes share one chain', () => {
  it('serialises a root mutation against a registry write', async () => {
    let disk: Record<string, unknown> = {};
    const storage: SyncStateStorage = {
      async load() {
        return structuredClone(disk);
      },
      async save(next: unknown) {
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

describe('SyncStateAdapter — the core baseline store', () => {
  it('round-trips a side baseline for an entity and field', async () => {
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await adapter.writeBaseline(
      notePath,
      'Status',
      'conformance',
      new Baseline('Done', false),
    );
    const read = await adapter.readBaseline(notePath, 'Status', 'conformance');

    expect(read?.value).toBe('Done');
    expect(read?.completed).toBe(false);
    expect(snapshot()['coreBaselines']).toEqual({
      [notePath]: {
        Status: { conformance: { value: 'Done', completed: false } },
      },
    });
  });

  it('round-trips the completion fact of a completion baseline', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await adapter.writeBaseline(
      'note.md',
      'completion',
      'origin',
      new Baseline('true', true),
    );
    const read = await adapter.readBaseline('note.md', 'completion', 'origin');

    expect(read?.value).toBe('true');
    expect(read?.completed).toBe(true);
  });

  it('returns null for an unknown baseline', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    expect(
      await adapter.readBaseline('note.md', 'Status', 'conformance'),
    ).toBeNull();
  });

  it('reads an archive baseline stored under the legacy lifecycle key', async () => {
    const { storage } = fakeStorage({
      coreBaselines: {
        Acme: { lifecycle: { origin: { value: 'true', completed: false } } },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    const read = await adapter.readBaseline('Acme', 'archived', 'origin');

    expect(read?.value).toBe('true');
  });

  it('prefers an archived baseline over a lingering legacy lifecycle key', async () => {
    const { storage } = fakeStorage({
      coreBaselines: {
        Acme: {
          archived: { origin: { value: 'false', completed: false } },
          lifecycle: { origin: { value: 'true', completed: false } },
        },
      },
    });
    const adapter = new SyncStateAdapter(storage);

    const read = await adapter.readBaseline('Acme', 'archived', 'origin');

    expect(read?.value).toBe('false');
  });

  it('leaves the existing chain bases untouched', async () => {
    const existing = {
      syncState: {
        version: 3,
        projects: {
          Acme: {
            ports: {
              conformance: {
                items: {
                  'board-1': { entityId: 'e1', base: { title: 'old' } },
                },
              },
            },
          },
        },
      },
    };
    const { storage, snapshot } = fakeStorage(existing);
    const adapter = new SyncStateAdapter(storage);

    await adapter.writeBaseline(
      'note.md',
      'Status',
      'conformance',
      new Baseline('Done', false),
    );

    const syncState = snapshot()['syncState'] as Record<string, unknown>;
    expect(syncState['projects']).toEqual(existing.syncState.projects);
  });

  it('keeps the core baselines when the registry writes the sync state', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await adapter.writeBaseline(
      'note.md',
      'Status',
      'conformance',
      new Baseline('Done', false),
    );
    await adapter.setEntity({
      id: 'entity-1',
      notePath: 'Projecten/Acme/taken/note.md',
    });

    const read = await adapter.readBaseline('note.md', 'Status', 'conformance');
    expect(read?.value).toBe('Done');
  });

  it('refuses a prototype-polluting entity id', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await expect(
      adapter.writeBaseline(
        '__proto__',
        'Status',
        'conformance',
        new Baseline('Done', false),
      ),
    ).rejects.toThrow(/forbidden storage key/);

    expect(Object.prototype.hasOwnProperty('Status')).toBe(false);
  });
});

const HANDLE_PROJECT = 'Acme';
const HANDLE_PATH = 'Projecten/Acme/taken/fix.md';
const HANDLE_PATH_2 = 'Projecten/Acme/taken/ship.md';

describe('SyncStateAdapter — entity to per-connection handle (F02 NWM-2)', () => {
  it('resolves the note path to its entity id and then to that connection handle', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(
      entityRecord({ id: 'uuid-1', notePath: HANDLE_PATH }),
    );
    await adapter.setMirrorItem(HANDLE_PROJECT, 'gh-main', 'issue-42', {
      entityId: 'uuid-1',
    });
    await adapter.setMirrorItem(HANDLE_PROJECT, 'td-work', 'task-9', {
      entityId: 'uuid-1',
    });

    expect(await adapter.resolveMirrorHandle('gh-main', HANDLE_PATH)).toBe(
      'issue-42',
    );
    expect(await adapter.resolveMirrorHandle('td-work', HANDLE_PATH)).toBe(
      'task-9',
    );
  });

  it('returns null when the note path maps to no entity', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    expect(
      await adapter.resolveMirrorHandle('gh-main', HANDLE_PATH),
    ).toBeNull();
  });

  it('returns null when the connection holds no item for the entity', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(
      entityRecord({ id: 'uuid-1', notePath: HANDLE_PATH }),
    );

    expect(
      await adapter.resolveMirrorHandle('gh-main', HANDLE_PATH),
    ).toBeNull();
  });

  it('records a new entity and its mirror item for a note path', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await adapter.recordMirrorHandle(
      HANDLE_PROJECT,
      'gh-main',
      HANDLE_PATH,
      'issue-1',
    );

    expect((await adapter.findByNotePath(HANDLE_PATH))?.notePath).toBe(
      HANDLE_PATH,
    );
    expect(await adapter.resolveMirrorHandle('gh-main', HANDLE_PATH)).toBe(
      'issue-1',
    );
  });

  it('records a mirror item against an existing entity', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(
      entityRecord({ id: 'uuid-1', notePath: HANDLE_PATH }),
    );

    await adapter.recordMirrorHandle(
      HANDLE_PROJECT,
      'gh-main',
      HANDLE_PATH,
      'issue-1',
    );

    expect((await adapter.findByNotePath(HANDLE_PATH))?.id).toBe('uuid-1');
    expect(await adapter.resolveMirrorHandle('gh-main', HANDLE_PATH)).toBe(
      'issue-1',
    );
  });

  it('replaces a placeholder handle with the real one', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(
      entityRecord({ id: 'uuid-1', notePath: HANDLE_PATH }),
    );

    await adapter.recordMirrorHandle(
      HANDLE_PROJECT,
      'gh-main',
      HANDLE_PATH,
      `pendingCreation:${HANDLE_PATH}`,
    );
    await adapter.recordMirrorHandle(
      HANDLE_PROJECT,
      'gh-main',
      HANDLE_PATH,
      'issue-1',
    );

    expect(
      await adapter.findMirrorItem('gh-main', `pendingCreation:${HANDLE_PATH}`),
    ).toBeNull();
    expect(await adapter.resolveMirrorHandle('gh-main', HANDLE_PATH)).toBe(
      'issue-1',
    );
  });

  it('lists the handles a connection holds with their note paths', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(
      entityRecord({ id: 'uuid-1', notePath: HANDLE_PATH }),
    );
    await adapter.setEntity(
      entityRecord({ id: 'uuid-2', notePath: HANDLE_PATH_2 }),
    );
    await adapter.setMirrorItem(HANDLE_PROJECT, 'gh-main', 'issue-1', {
      entityId: 'uuid-1',
    });
    await adapter.setMirrorItem(HANDLE_PROJECT, 'gh-main', 'issue-2', {
      entityId: 'uuid-2',
    });
    await adapter.setMirrorItem(HANDLE_PROJECT, 'td-work', 'task-9', {
      entityId: 'uuid-1',
    });

    expect(await adapter.listMirrorHandles(HANDLE_PROJECT, 'gh-main')).toEqual([
      { handle: 'issue-1', notePath: HANDLE_PATH },
      { handle: 'issue-2', notePath: HANDLE_PATH_2 },
    ]);
  });
});

describe('SyncStateAdapter — the mirror project handle (F02 NWM-2)', () => {
  it('returns null when the connection holds no mirror project', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    expect(await adapter.resolveMirrorProject('Acme', 'gh-main')).toBeNull();
  });

  it('treats an empty recorded project as no mirror project', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setPortState('Acme', 'gh-main', {
      provider: 'github',
      project: '',
      lastPoll: null,
      lanes: {},
    });

    expect(await adapter.resolveMirrorProject('Acme', 'gh-main')).toBeNull();
  });

  it('records the mirror project handle and resolves it back', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    await adapter.recordMirrorProject(
      'Acme',
      'gh-main',
      'github',
      'https://github.com/acme/widgets',
    );

    expect(await adapter.resolveMirrorProject('Acme', 'gh-main')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  it('preserves the existing port bookkeeping when recording', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setPortState('Acme', 'gh-main', {
      provider: 'github',
      project: '',
      lastPoll: '2026-01-01T00:00:00Z',
      lanes: { a: 'x' },
    });

    await adapter.recordMirrorProject('Acme', 'gh-main', 'github', 'board-1');

    expect(await adapter.getPortState('Acme', 'gh-main')).toEqual({
      provider: 'github',
      project: 'board-1',
      lastPoll: '2026-01-01T00:00:00Z',
      lanes: { a: 'x' },
    });
  });
});

describe('REG-1, PLC-2 — a project rename re-keys the registry node', () => {
  it('moves entities, ports, identities and the archive baseline to the new name', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    await adapter.setEntity(
      entityRecord({
        id: 'entity-1',
        notePath: 'Projecten/Old Name/taken/42-fix-the-bug.md',
      }),
    );
    await adapter.setPortState('Old Name', 'github', {
      provider: 'github',
      project: 'https://github.com/acme/widgets',
      lastPoll: null,
      lanes: {},
    });
    await adapter.setIdentity('Old Name', 'github', identity);
    await adapter.writeBaseline(
      'Old Name',
      'archived',
      'origin',
      new Baseline('true', false),
    );

    await adapter.rekeyProject('Old Name', 'New Name');

    expect(await adapter.hasProject('Old Name')).toBe(false);
    expect(await adapter.hasProject('New Name')).toBe(true);
    expect(await adapter.listEntities('New Name')).toEqual([
      {
        id: 'entity-1',
        notePath: 'Projecten/New Name/taken/42-fix-the-bug.md',
      },
    ]);
    expect(await adapter.getPortState('New Name', 'github')).not.toBeNull();
    expect(await adapter.getIdentity('New Name', 'github')).not.toBeNull();
    expect(
      (await adapter.readBaseline('New Name', 'archived', 'origin'))?.value,
    ).toBe('true');
    expect(
      await adapter.readBaseline('Old Name', 'archived', 'origin'),
    ).toBeNull();
  });

  it('reports no project for a name the registry does not file', async () => {
    const { storage } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);

    expect(await adapter.hasProject('Missing')).toBe(false);
    expect(await adapter.listProjects()).toEqual([]);
  });
});

const conformanceHarness: SyncStateConformanceHarness = {
  create() {
    const { storage } = fakeStorage();
    return new SyncStateAdapter(storage);
  },
};

runSyncStateConformance('SyncStateAdapter', conformanceHarness);
