import { describe, expect, it } from 'vitest';
import {
  folderChainForPath,
  freePath,
  projectFolderFromNotePath,
  projectFromNotePath,
  projectHomePath,
  projectHomeStem,
  projectNameFromFolder,
} from '../../../src/core/domain/paths.js';
import { FakeVault as FakeVaultBase } from '../../helpers/fakeVault.js';

// A vault fake backed by a path set, so the collision walk is observable.
class FakeVault extends FakeVaultBase {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Set<string>();

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    return this.notes.has(path) ? { content: '' } : null;
  }

  override async createNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async writeNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async moveFolder(): Promise<void> {}

  override async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  override onNoteChanged(): void {}
  override onNoteDeleted(): void {}
  override onNoteRenamed(): void {}
}

describe('DISC-3 — a project under Archief is the same project, archived', () => {
  it('keys both roots to the same project name, so archiving never re-keys identity', () => {
    expect(
      projectFromNotePath('Projecten/Acme Widgets/taken/42-fix-the-bug.md'),
    ).toBe('Acme Widgets');
    expect(
      projectFromNotePath('Archief/Acme Widgets/taken/42-fix-the-bug.md'),
    ).toBe('Acme Widgets');
    expect(projectFromNotePath('Archief/Acme Widgets/_Acme Widgets.md')).toBe(
      'Acme Widgets',
    );
  });
});

describe('DISC-4 — only the project root names the project', () => {
  it('returns the second segment for a nested note, and empty for a non-project path', () => {
    expect(
      projectFromNotePath('Projecten/Acme Widgets/taken/nested/deep.md'),
    ).toBe('Acme Widgets');
    expect(projectFromNotePath('Templates/ToDo.md')).toBe('');
    expect(projectFromNotePath('taken/42-orphan.md')).toBe('');
  });
});

describe('DISC-2 — the home note path follows the convention', () => {
  it('builds the active home path under Projecten', () => {
    const path = projectHomePath('Acme Widgets', false);

    expect(path).toBe('Projecten/Acme Widgets/_Acme Widgets.md');
  });

  it('builds the archived home path under Archief', () => {
    const path = projectHomePath('Acme Widgets', true);

    expect(path).toBe('Archief/Acme Widgets/_Acme Widgets.md');
  });

  it('keeps the stem unique to the project', () => {
    const first = projectHomeStem('Acme Widgets');
    const second = projectHomeStem('Other Project');

    expect(first).toBe('_Acme Widgets');
    expect(second).toBe('_Other Project');
  });
});

// The pure decision behind VaultAdapter.createNote: given a note path, the
// ordered list of folder paths that must exist for it, from the vault root
// down. Obsidian's createFolder only makes one level, so the adapter walks
// this list in order to build the chain (mkdir -p semantics). It is unit
// tested here because the vault itself is awkward to fake; the adapter's
// application of it is covered in the integration pass.
describe('DISC-1 — the folder chain is derived from the path', () => {
  it('returns an empty list for a root-level file', () => {
    const path = 'note.md';

    const chain = folderChainForPath(path);

    expect(chain).toEqual([]);
  });

  it('returns the single parent folder for a one-level path', () => {
    const path = 'Projecten/note.md';

    const chain = folderChainForPath(path);

    expect(chain).toEqual(['Projecten']);
  });

  it('returns every ancestor folder in order for a deeply nested path', () => {
    const path = 'Projecten/Plugintest/taken/28-x.md';

    const chain = folderChainForPath(path);

    expect(chain).toEqual([
      'Projecten',
      'Projecten/Plugintest',
      'Projecten/Plugintest/taken',
    ]);
  });

  it('yields no empty segments for an already-clean path', () => {
    const path = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

    const chain = folderChainForPath(path);

    expect(chain).toEqual([
      'Projecten',
      'Projecten/Acme Widgets',
      'Projecten/Acme Widgets/taken',
    ]);
    expect(chain.every((folder) => folder.length > 0)).toBe(true);
  });
});

describe('MAT-5 — a taken slug gains an ordinal', () => {
  it('returns the base path when it is free', async () => {
    const vault = new FakeVault();

    const path = await freePath(vault, 'Projecten/X/taken/fix-the-bug.md');

    expect(path).toBe('Projecten/X/taken/fix-the-bug.md');
  });

  it('suffixes -2 when the base path is taken', async () => {
    const vault = new FakeVault();
    vault.notes.add('Projecten/X/taken/fix-the-bug.md');

    const path = await freePath(vault, 'Projecten/X/taken/fix-the-bug.md');

    expect(path).toBe('Projecten/X/taken/fix-the-bug-2.md');
  });

  it('walks past taken suffixes', async () => {
    const vault = new FakeVault();
    vault.notes.add('Projecten/X/taken/fix-the-bug.md');
    vault.notes.add('Projecten/X/taken/fix-the-bug-2.md');

    const path = await freePath(vault, 'Projecten/X/taken/fix-the-bug.md');

    expect(path).toBe('Projecten/X/taken/fix-the-bug-3.md');
  });
});

// S31 — the project is addressed by its folder, and the name is the folder
// segment. Both roots are addressable, so an archived project resolves the
// same way an active one does.
describe('S31 — a project folder names the project', () => {
  it('derives the folder from a note path under either root', () => {
    expect(
      projectFolderFromNotePath('Projecten/Acme Widgets/taken/42-fix.md'),
    ).toBe('Projecten/Acme Widgets');
    expect(
      projectFolderFromNotePath('Archief/Acme Widgets/_Acme Widgets.md'),
    ).toBe('Archief/Acme Widgets');
  });

  it('returns null for a path outside the two project roots', () => {
    expect(projectFolderFromNotePath('Notes/Other.md')).toBeNull();
    expect(projectFolderFromNotePath('Projecten')).toBeNull();
  });

  it('reads the name from the folder segment', () => {
    expect(projectNameFromFolder('Projecten/Acme Widgets')).toBe(
      'Acme Widgets',
    );
    expect(projectNameFromFolder('Archief/Acme Widgets')).toBe('Acme Widgets');
    expect(projectNameFromFolder('Notes/Other')).toBeNull();
  });
});
