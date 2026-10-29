import { describe, expect, it, vi } from 'vitest';
import { MigrateNoteFilenamesAction } from '../../../../src/core/application/actions/MigrateNoteFilenamesAction.js';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import { ORIGIN_SIDE } from '../../../../src/core/domain/sides.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { entityRecord } from '../../../helpers/records.js';

// The one-shot filename migration: every taken note's file is renamed to the
// title the ledger's baseline holds — the last-known value from a side, read
// locally, no remote read. A note with no baseline title is left alone and
// reported, never guessed. The pass is idempotent and a rename preserves the
// note's id, its record and its baseline.
const PROJECT = 'Acme';
const TAKEN = `Projecten/${PROJECT}/taken`;
const ARCHIVED = `Archief/${PROJECT}/taken`;

class FakeVault extends FakeVaultBase {
  readonly notes = new Map<string, string>();
  readonly renames: Array<{ from: string; to: string }> = [];

  seed(path: string): void {
    this.notes.set(path, '---\nlabels: [type:task]\n---\n');
  }

  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = this.notes.get(oldPath);
    this.notes.delete(oldPath);
    if (content !== undefined) {
      this.notes.set(newPath, content);
    }
    this.renames.push({ from: oldPath, to: newPath });
  }
}

function harness(): {
  action: MigrateNoteFilenamesAction;
  vault: FakeVault;
  syncState: FakeSyncState;
} {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  return {
    action: new MigrateNoteFilenamesAction(vault, syncState),
    vault,
    syncState,
  };
}

async function noteWithTitle(
  h: ReturnType<typeof harness>,
  path: string,
  title: string,
): Promise<void> {
  h.vault.seed(path);
  h.syncState.seed(
    entityRecord({ id: `entity-${path}`, notePath: path, projectId: PROJECT }),
  );
  await h.syncState.writeBaseline(
    path,
    'title',
    ORIGIN_SIDE,
    new Baseline(title, false),
  );
}

describe('the filename migration renames each note to its baseline title', () => {
  it('renames a slugged filename to the title the baseline holds', async () => {
    const h = harness();
    const oldPath = `${TAKEN}/61-fix-a-to-do-twin.md`;
    await noteWithTitle(h, oldPath, 'fix a to-do twin');

    await h.action.execute({ projectName: PROJECT });

    expect(h.vault.renames).toEqual([
      { from: oldPath, to: `${TAKEN}/fix a to-do twin.md` },
    ]);
  });

  it('renders through renderFilename — a colon becomes a space', async () => {
    const h = harness();
    const oldPath = `${TAKEN}/61-fix-a-to-do-twin.md`;
    await noteWithTitle(h, oldPath, 'fix: a to-do twin');

    await h.action.execute({ projectName: PROJECT });

    expect(h.vault.renames).toEqual([
      { from: oldPath, to: `${TAKEN}/fix a to-do twin.md` },
    ]);
  });

  it('renames a note under Archief as well', async () => {
    const h = harness();
    const oldPath = `${ARCHIVED}/61-fix-a-to-do-twin.md`;
    await noteWithTitle(h, oldPath, 'fix a to-do twin');

    await h.action.execute({ projectName: PROJECT });

    expect(h.vault.renames).toEqual([
      { from: oldPath, to: `${ARCHIVED}/fix a to-do twin.md` },
    ]);
  });
});

describe('the filename migration leaves and reports what it cannot recover', () => {
  it('leaves a note with no baseline title alone and reports it', async () => {
    const h = harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const path = `${TAKEN}/untracked.md`;
    h.vault.seed(path);

    await h.action.execute({ projectName: PROJECT });

    expect(h.vault.renames).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(path));
    warn.mockRestore();
  });

  it('leaves a note whose baseline title cannot render alone and reports it', async () => {
    const h = harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const path = `${TAKEN}/weird.md`;
    await noteWithTitle(h, path, '...');

    await h.action.execute({ projectName: PROJECT });

    expect(h.vault.renames).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(path));
    warn.mockRestore();
  });

  it('leaves two notes that render to one filename alone and reports it', async () => {
    const h = harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = `${TAKEN}/61-fix-a-to-do-twin.md`;
    const second = `${TAKEN}/62-fix-a-to-do-twin.md`;
    await noteWithTitle(h, first, 'fix: a to-do twin');
    await noteWithTitle(h, second, 'fix:  a to-do twin');

    await h.action.execute({ projectName: PROJECT });

    expect(h.vault.renames).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the filename migration is idempotent and preserves the note', () => {
  it('leaves an already correctly named note untouched', async () => {
    const h = harness();
    await noteWithTitle(h, `${TAKEN}/fix a to-do twin.md`, 'fix a to-do twin');

    await h.action.execute({ projectName: PROJECT });

    expect(h.vault.renames).toEqual([]);
  });

  it('writes nothing on a second run', async () => {
    const h = harness();
    const oldPath = `${TAKEN}/61-fix-a-to-do-twin.md`;
    await noteWithTitle(h, oldPath, 'fix a to-do twin');

    await h.action.execute({ projectName: PROJECT });
    const renamesAfterFirst = h.vault.renames.length;

    await h.action.execute({ projectName: PROJECT });

    expect(h.vault.renames.length).toBe(renamesAfterFirst);
    expect(h.vault.notes.has(`${TAKEN}/fix a to-do twin.md`)).toBe(true);
  });

  it('re-keys the record and the baseline without changing the id', async () => {
    const h = harness();
    const oldPath = `${TAKEN}/61-fix-a-to-do-twin.md`;
    const newPath = `${TAKEN}/fix a to-do twin.md`;
    await noteWithTitle(h, oldPath, 'fix a to-do twin');

    await h.action.execute({ projectName: PROJECT });

    expect((await h.syncState.findByNotePath(newPath))?.id).toBe(
      `entity-${oldPath}`,
    );
    expect(await h.syncState.findByNotePath(oldPath)).toBeNull();
    expect(
      await h.syncState.readBaseline(newPath, 'title', ORIGIN_SIDE),
    ).toEqual(new Baseline('fix a to-do twin', false));
    expect(
      await h.syncState.readBaseline(oldPath, 'title', ORIGIN_SIDE),
    ).toBeNull();
  });
});
