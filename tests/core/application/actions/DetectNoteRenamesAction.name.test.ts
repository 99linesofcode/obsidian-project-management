import { describe, expect, it } from 'vitest';
import { DetectNoteRenamesAction } from '../../../../src/core/application/actions/DetectNoteRenamesAction.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { entityRecord } from '../../../helpers/records.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

// NAME-4 / REN-1, the #180 case. Today the detector pairs a vanished path to an
// untracked note by `normalizedStem` alone, so a rename that changes the stem
// reads as an absence. Under S30 the detector reads each untracked note's
// declared `name:` and pairs a vanished record with a note whose declared name
// slugs to the vanished note's stem. A real note's declared `name:` is the
// human title, not the slug: `TaskNoteMapper` writes `name: ${task.title}` and
// puts the note at `slugify(title)`, so the note at `fix-the-bug.md` declares
// `name: Fix the Bug!`. The detector must therefore slugify the declared name
// before comparing it to a stem. This suite uses a stem with no leading digits
// to keep raw and normalised stems equal and remove that ambiguity.
class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  folders = new Map<string, string[]>();

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  override async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folders.get(folder) ?? [];
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

function noteWithName(name: string): string {
  return ['---', `name: ${name}`, '---', ''].join('\n');
}

const syncedAt = '2026-09-18T12:00:00Z';

describe('NAME-4 — a stem-changing rename is a mismatch, not an absence (#180)', () => {
  it('re-keys a vanished record to a note whose declared `name:` slugs to the vanished stem', async () => {
    const h = harness();
    const oldPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    const newPath = 'Projecten/Acme Widgets/taken/renamed-note.md';
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: oldPath }), {
      github: { handle: 'https://github.com/acme/widgets/issues/42' },
    });
    h.vault.folders.set('Projecten/Acme Widgets/taken', [newPath]);
    h.vault.notes.set(newPath, noteWithName('Fix the Bug!'));

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    const record = await h.syncState.get('uuid-1');
    expect(record?.notePath).toBe(newPath);
    expect(h.syncState.handleOf('uuid-1', 'github')).toBe(
      'https://github.com/acme/widgets/issues/42',
    );
  });

  it('leaves a vanished record alone when no untracked note declares its stem', async () => {
    const h = harness();
    const oldPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    const otherPath = 'Projecten/Acme Widgets/taken/renamed-note.md';
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: oldPath }));
    h.vault.folders.set('Projecten/Acme Widgets/taken', [otherPath]);
    h.vault.notes.set(otherPath, noteWithName('A Different Title'));

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect(h.syncState.setCalls).toEqual([]);
  });
});
