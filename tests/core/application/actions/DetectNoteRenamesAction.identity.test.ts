import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetectNoteRenamesAction } from '../../../../src/core/application/actions/DetectNoteRenamesAction.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { entityRecord } from '../../../helpers/records.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

// S31 IDN-3: a rename is detected by the note's own id, and REN-1's same-stem
// guess retires. A move between project folders — or into `Archief/` — is a
// rename, not a deletion, so the record keeps its note and its mirrors. The
// fake vault exposes the pinned `readNoteIds()` surface; the current detector
// pairs by stem inside one project folder and so cannot find either move.
class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  folders = new Map<string, string[]>();
  noteIds: ReadonlyArray<{ id: string; path: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  override async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folders.get(folder) ?? [];
  }
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

const syncedAt = '2026-10-28T12:00:00Z';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IDN-3 — a note moved between project folders keeps its record', () => {
  it('re-keys a vanished record to the note carrying the same id in another project', async () => {
    const h = harness();
    const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
    const newPath = 'Projecten/Other Project/taken/entirely-different.md';
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: oldPath }), {
      github: { handle: 'https://github.com/acme/widgets/issues/42' },
    });
    h.vault.noteIds = [{ id: 'uuid-1', path: newPath }];

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    const record = await h.syncState.get('uuid-1');
    expect(record?.notePath).toBe(newPath);
    expect(h.syncState.handleOf('uuid-1', 'github')).toBe(
      'https://github.com/acme/widgets/issues/42',
    );
  });

  it('re-keys a vanished record to the note carrying the same id under Archief', async () => {
    const h = harness();
    const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
    const newPath = 'Archief/Acme Widgets/taken/42-fix-the-bug.md';
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: oldPath }), {
      github: { handle: 'https://github.com/acme/widgets/issues/42' },
    });
    h.vault.noteIds = [{ id: 'uuid-1', path: newPath }];

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect((await h.syncState.get('uuid-1'))?.notePath).toBe(newPath);
  });
});

describe('DUP-1 — two notes carrying one id: the first wins, the other is reported', () => {
  it('keeps the first note for the id and reports the second', async () => {
    const h = harness();
    const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
    const firstPath = 'Projecten/Acme Widgets/taken/first.md';
    const secondPath = 'Projecten/Acme Widgets/taken/second.md';
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: oldPath }), {
      github: { handle: 'https://github.com/acme/widgets/issues/42' },
    });
    h.vault.noteIds = [
      { id: 'uuid-1', path: firstPath },
      { id: 'uuid-1', path: secondPath },
    ];
    const reports: unknown[][] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      reports.push(args);
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      reports.push(args);
    });

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect((await h.syncState.get('uuid-1'))?.notePath).toBe(firstPath);
    expect(reports.flat().join(' ')).toContain('uuid-1');
  });
});
