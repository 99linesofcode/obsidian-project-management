import { describe, expect, it } from 'vitest';
import { SweepDeletedNotesAction } from '../../../../src/core/application/actions/SweepDeletedNotesAction.js';
import type { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { entityRecord } from '../../../helpers/records.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

const githubConnection = {
  slug: 'github',
  application: 'github',
  target: 'https://github.com/acme/widgets',
};

// The sweep's deletion proof moves from path existence to the note's own id
// (IDN-5). A record whose note path is gone is only a deletion when no note
// carries its id; when the id is present at a new path the note merely moved
// and nothing is swept. DEL-1 restores the inverse: a note whose id reappears
// clears the tombstone the sweep had recorded for it.
class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  noteIds: ReadonlyArray<{ id: string; path: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async readNoteIds(): Promise<
    readonly { id: string; path: string }[]
  > {
    return this.noteIds;
  }
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const deleted: string[] = [];
  const handleDeleted = {
    execute: async (input: { notePath: string }) => {
      deleted.push(input.notePath);
    },
  } as unknown as HandleDeletedNoteAction;
  const action = new SweepDeletedNotesAction(vault, syncState, handleDeleted);
  return { action, vault, syncState, deleted };
}

const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

describe('IDN-5 — a deletion is proved by the note id, never by the path alone', () => {
  it('leaves a record whose id is present at a new path alone', async () => {
    const h = harness();
    h.syncState.seed(entityRecord({ id: 'entity-1', notePath: oldPath }), {
      github: { handle: 'GH-42' },
    });
    h.vault.noteIds = [
      { id: 'entity-1', path: 'Projecten/Acme Widgets/taken/fix-the-bug.md' },
    ];

    await h.action.execute({
      projectName: 'Acme Widgets',
      connections: [githubConnection],
    });

    expect(h.deleted).toEqual([]);
    expect(await h.syncState.findTombstoneByNotePath(oldPath)).toBeNull();
  });

  it('deletes a record whose id is nowhere', async () => {
    const h = harness();
    h.syncState.seed(entityRecord({ id: 'entity-1', notePath: oldPath }), {
      github: { handle: 'GH-42' },
    });
    h.vault.noteIds = [];

    await h.action.execute({
      projectName: 'Acme Widgets',
      connections: [githubConnection],
    });

    expect(h.deleted).toEqual([oldPath]);
    expect(await h.syncState.findTombstoneByNotePath(oldPath)).not.toBeNull();
  });
});

describe('DEL-1 — a restored note clears its own tombstone', () => {
  it('clears the tombstone when the note carrying the id is back', async () => {
    const h = harness();
    h.syncState.records.set(
      'entity-1',
      entityRecord({ id: 'entity-1', notePath: oldPath }),
    );
    await h.syncState.recordTombstone({
      entityId: 'entity-1',
      notePath: oldPath,
      deletedAt: '2026-10-13T00:00:00Z',
      handle: 'GH-42',
    });
    h.vault.notes.set(oldPath, 'restored content');
    h.vault.noteIds = [{ id: 'entity-1', path: oldPath }];

    await h.action.execute({
      projectName: 'Acme Widgets',
      connections: [githubConnection],
    });

    expect(await h.syncState.findTombstoneByNotePath(oldPath)).toBeNull();
    expect(h.deleted).toEqual([]);
  });
});
