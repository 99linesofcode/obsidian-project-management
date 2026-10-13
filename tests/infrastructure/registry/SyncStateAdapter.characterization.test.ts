import { describe, expect, it } from 'vitest';
import {
  SYNC_STATE_KEY,
  SyncStateAdapter,
  type SyncStateStorage,
} from '../../../src/infrastructure/registry/SyncStateAdapter.js';
import { entityRecord } from '../../helpers/records.js';

function fakeStorage(): {
  storage: SyncStateStorage;
  snapshot: () => Record<string, unknown>;
} {
  let data: Record<string, unknown> = {};
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

// Characterization for S17c: today the registry files a project under the
// folder segment of its notes — that segment IS the project key. Passes today;
// PLC-2 moves the project node to the note's `project` property.
describe('characterization — the registry keys the project by the folder (today)', () => {
  it('nests an entity under projects.<folder segment>', async () => {
    const { storage, snapshot } = fakeStorage();
    const adapter = new SyncStateAdapter(storage);
    const record = entityRecord({
      id: 'entity-1',
      notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    });

    await adapter.setEntity(record);

    const container = snapshot()[SYNC_STATE_KEY] as Record<string, unknown>;
    const projects = container['projects'] as Record<string, unknown>;
    expect(projects['Acme Widgets']).toBeDefined();
    expect(await adapter.listEntities('Acme Widgets')).toEqual([record]);
  });
});
