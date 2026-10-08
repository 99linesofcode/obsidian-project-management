import { describe, expect, it } from 'vitest';
import { Baseline } from '../../../src/core/data/Baseline.js';
import { CoreBaselineStoreAdapter } from '../../../src/infrastructure/registry/CoreBaselineStoreAdapter.js';
import { SyncStateAdapter } from '../../../src/registry/SyncStateAdapter.js';

function fakeStorage(initial: Record<string, unknown> = {}) {
  let data: Record<string, unknown> = initial;
  return {
    storage: {
      async load() {
        return data;
      },
      async save(next: unknown) {
        data = next as Record<string, unknown>;
      },
    },
    snapshot: () => data,
  };
}

describe('CoreBaselineStoreAdapter — the core baseline store', () => {
  it('round-trips a side baseline for an entity and field', async () => {
    const { storage, snapshot } = fakeStorage();
    const store = new CoreBaselineStoreAdapter(storage);

    await store.write(
      'Projecten/Acme/taken/fix.md',
      'Status',
      'conformance',
      new Baseline('Done', false),
    );
    const read = await store.read(
      'Projecten/Acme/taken/fix.md',
      'Status',
      'conformance',
    );

    expect(read?.value).toBe('Done');
    expect(read?.completed).toBe(false);
    expect(snapshot()['coreBaselines']).toEqual({
      'Projecten/Acme/taken/fix.md': {
        Status: { conformance: { value: 'Done', completed: false } },
      },
    });
  });

  it('round-trips the completion fact of a completion baseline', async () => {
    const { storage } = fakeStorage();
    const store = new CoreBaselineStoreAdapter(storage);

    await store.write(
      'note.md',
      'completion',
      'origin',
      new Baseline('true', true),
    );
    const read = await store.read('note.md', 'completion', 'origin');

    expect(read?.value).toBe('true');
    expect(read?.completed).toBe(true);
  });

  it('returns null for an unknown baseline', async () => {
    const { storage } = fakeStorage();
    const store = new CoreBaselineStoreAdapter(storage);

    expect(await store.read('note.md', 'Status', 'conformance')).toBeNull();
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
    const store = new CoreBaselineStoreAdapter(storage);

    await store.write(
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
    const store = new CoreBaselineStoreAdapter(storage);
    const registry = new SyncStateAdapter(storage);

    await store.write(
      'note.md',
      'Status',
      'conformance',
      new Baseline('Done', false),
    );
    await registry.setEntity({
      id: 'entity-1',
      notePath: 'Projecten/Acme/taken/note.md',
    });

    const read = await store.read('note.md', 'Status', 'conformance');
    expect(read?.value).toBe('Done');
  });
});
