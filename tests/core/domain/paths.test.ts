import { describe, expect, it } from 'vitest';
import {
  chooseHomeNotePath,
  folderChainForPath,
  freePath,
  projectFromNotePath,
  projectHomePath,
  projectHomeStem,
  projectPathWithName,
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

describe('DISC-2 — home note discovery prefers the convention', () => {
  it('prefers the conventional home note when a legacy one lingers beside it', () => {
    const chosen = chooseHomeNotePath(
      [
        'Projecten/Acme Widgets/_home.md',
        'Projecten/Acme Widgets/_Acme Widgets.md',
      ],
      'Acme Widgets',
    );

    expect(chosen).toBe('Projecten/Acme Widgets/_Acme Widgets.md');
  });

  it('falls back to the only candidate when no conventional note exists', () => {
    const chosen = chooseHomeNotePath(
      ['Projecten/Acme Widgets/_home.md'],
      'Acme Widgets',
    );

    expect(chosen).toBe('Projecten/Acme Widgets/_home.md');
  });

  it('returns null when the project has no home note', () => {
    expect(chooseHomeNotePath([], 'Acme Widgets')).toBeNull();
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

// PLC-1 — the folder and the home-note filename derive from the project's name,
// so renaming a project rewrites the note path's project segment and leaves
// every other segment — the derived home note included — intact.
describe('PLC-1 — a note path is re-derived under a renamed project', () => {
  it('derives the home note under the new project name', () => {
    expect(
      projectPathWithName('Projecten/Old Name/_Old Name.md', 'New Name'),
    ).toBe('Projecten/New Name/_Old Name.md');
  });

  it('rewrites the segment for a taken note and for an archived root', () => {
    expect(
      projectPathWithName(
        'Projecten/Old Name/taken/42-fix-the-bug.md',
        'New Name',
      ),
    ).toBe('Projecten/New Name/taken/42-fix-the-bug.md');
    expect(
      projectPathWithName('Archief/Old Name/_Old Name.md', 'New Name'),
    ).toBe('Archief/New Name/_Old Name.md');
  });

  it('leaves a path outside the two project roots alone', () => {
    expect(projectPathWithName('Notes/Other.md', 'New Name')).toBe(
      'Notes/Other.md',
    );
  });
});
