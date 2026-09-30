import { describe, expect, it } from 'vitest';
import { RelocateTaskStatusAction } from '../../../src/Domain/Actions/RelocateTaskStatusAction.js';
import { entityRecord, mirror } from '../../helpers/records.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const newPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug-v2.md';
const url = 'https://github.com/acme/widgets/issues/42';

describe('RelocateTaskStatusAction', () => {
  it("moves the registry record's notePath to the new path", async () => {
    // Given — a record pointing at the note's old path, with a mirror
    const syncState = new FakeSyncState();
    const record = entityRecord({
      id: 'uuid-42',
      notePath: oldPath,
      mirrors: { github: mirror(url) },
    });
    syncState.records.set('uuid-42', record);
    const action = new RelocateTaskStatusAction(syncState);

    // When — the task note rename is followed
    await action.execute({ oldPath, newPath });

    // Then — the record moves, its identity and mirrors intact
    const moved = await syncState.get('uuid-42');
    expect(moved?.notePath).toBe(newPath);
    expect(moved?.mirrors.github?.handle).toBe(url);
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
