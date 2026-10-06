import { describe, expect, it } from 'vitest';
import { RelocateTaskStatusAction } from '../../src/tasks/RelocateTaskStatusAction.js';
import { entityRecord } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const newPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug-v2.md';

describe('REN-1 — a rename relocates the status', () => {
  it("moves the registry record's notePath to the new path", async () => {
    const syncState = new FakeSyncState();
    const record = entityRecord({
      id: 'uuid-42',
      notePath: oldPath,
    });
    syncState.records.set('uuid-42', record);
    const action = new RelocateTaskStatusAction(syncState);

    await action.execute({ oldPath, newPath });

    const moved = await syncState.get('uuid-42');
    expect(moved?.notePath).toBe(newPath);
    expect(moved?.id).toBe('uuid-42');
  });

  it('does nothing when no record matches the old path', async () => {
    const syncState = new FakeSyncState();
    const action = new RelocateTaskStatusAction(syncState);

    await action.execute({ oldPath, newPath });

    expect(await syncState.list()).toEqual([]);
  });
});
