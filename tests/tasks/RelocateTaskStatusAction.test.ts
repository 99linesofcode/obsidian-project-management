import { describe, expect, it } from 'vitest';
import { RelocateTaskStatusAction } from '../../src/tasks/RelocateTaskStatusAction.js';
import { entityRecord } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const newPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug-v2.md';

describe('RelocateTaskStatusAction', () => {
  it("moves the registry record's notePath to the new path", async () => {
    // Given — a record pointing at the note's old path, with a mirror
    const syncState = new FakeSyncState();
    const record = entityRecord({
      id: 'uuid-42',
      notePath: oldPath,
    });
    syncState.records.set('uuid-42', record);
    const action = new RelocateTaskStatusAction(syncState);

    // When — the task note rename is followed
    await action.execute({ oldPath, newPath });

    // Then — the record moves, its identity intact
    const moved = await syncState.get('uuid-42');
    expect(moved?.notePath).toBe(newPath);
    expect(moved?.id).toBe('uuid-42');
  });

  it('does nothing when no record matches the old path', async () => {
    // Given — no record for the renamed note
    const syncState = new FakeSyncState();
    const action = new RelocateTaskStatusAction(syncState);

    // When — the task note rename is followed
    await action.execute({ oldPath, newPath });

    // Then — nothing is saved
    expect(await syncState.list()).toEqual([]);
  });
});
