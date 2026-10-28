import { describe, expect, it } from 'vitest';
import { DetectNoteRenamesAction } from '../../../../src/core/application/actions/DetectNoteRenamesAction.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { entityRecord } from '../../../helpers/records.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

class FakeVault extends FakeVaultBase {
  noteIds: ReadonlyArray<{ id: string; path: string }> = [];

  override async readNoteIds(): Promise<
    readonly { id: string; path: string }[]
  > {
    return this.noteIds;
  }
  override async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  override onNoteChanged(): void {}
  override onNoteDeleted(): void {}
  override onNoteRenamed(): void {}
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const action = new DetectNoteRenamesAction(vault, syncState);
  return { action, vault, syncState };
}

const syncedAt = '2026-09-18T12:00:00Z';
const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const newPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';

describe('REN-1 — a rename while Obsidian runs keeps identity', () => {
  it('re-keys a vanished-path record to the note carrying the same id, mirrors intact', async () => {
    const h = harness();
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: oldPath }), {
      github: {
        handle: 'https://github.com/acme/widgets/issues/42',
      },
    });
    h.vault.noteIds = [{ id: 'uuid-1', path: newPath }];

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    const record = await h.syncState.get('uuid-1');
    expect(record?.notePath).toBe(newPath);
    expect(h.syncState.handleOf('uuid-1', 'github')).toBe(
      'https://github.com/acme/widgets/issues/42',
    );
  });

  it('pairs a to-do record whose note was renamed', async () => {
    const h = harness();
    const oldTodo = 'Projecten/Acme Widgets/taken/42-ship-it.md';
    const newTodo = 'Projecten/Acme Widgets/taken/ship-it.md';
    h.syncState.seed(entityRecord({ id: 'todo-uuid', notePath: oldTodo }), {
      todoist: { handle: 'T9' },
    });
    h.vault.noteIds = [{ id: 'todo-uuid', path: newTodo }];

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect((await h.syncState.get('todo-uuid'))?.notePath).toBe(newTodo);
  });

  it('leaves a record whose note still exists alone', async () => {
    const h = harness();
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: newPath }));
    h.vault.noteIds = [{ id: 'uuid-1', path: newPath }];

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect(h.syncState.setCalls).toEqual([]);
  });

  it('leaves a record whose note is gone and whose id is nowhere alone', async () => {
    const h = harness();
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: oldPath }));
    h.vault.noteIds = [
      { id: 'other-uuid', path: 'Projecten/Acme Widgets/taken/99-other.md' },
    ];

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect(h.syncState.setCalls).toEqual([]);
  });

  it('pairs each vanished record to its own id', async () => {
    const h = harness();
    const oldA = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
    const newA = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    const oldB = 'Projecten/Acme Widgets/taken/43-ship-it.md';
    const newB = 'Projecten/Acme Widgets/taken/ship-it.md';
    h.syncState.seed(entityRecord({ id: 'uuid-a', notePath: oldA }));
    h.syncState.seed(entityRecord({ id: 'uuid-b', notePath: oldB }));
    h.vault.noteIds = [
      { id: 'uuid-a', path: newA },
      { id: 'uuid-b', path: newB },
    ];

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect((await h.syncState.get('uuid-a'))?.notePath).toBe(newA);
    expect((await h.syncState.get('uuid-b'))?.notePath).toBe(newB);
  });
});
