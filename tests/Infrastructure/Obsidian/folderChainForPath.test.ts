import { describe, expect, it } from 'vitest';
import { folderChainForPath } from '../../../src/Infrastructure/Obsidian/folderChainForPath.js';

// The pure decision behind VaultAdapter.createNote: given a note path, the
// ordered list of folder paths that must exist for it, from the vault root
// down. Obsidian's createFolder only makes one level, so the adapter walks
// this list in order to build the chain (mkdir -p semantics). It is unit
// tested here because the vault itself is awkward to fake; the adapter's
// application of it is covered in the integration pass.
describe('folderChainForPath', () => {
  it('returns an empty list for a root-level file', () => {
    // Given — a note at the vault root
    const path = 'note.md';

    // When — its folder chain is computed
    const chain = folderChainForPath(path);

    // Then — there are no folders to create
    expect(chain).toEqual([]);
  });

  it('returns the single parent folder for a one-level path', () => {
    // Given — a note one folder deep
    const path = 'Projecten/note.md';

    // When — its folder chain is computed
    const chain = folderChainForPath(path);

    // Then — only the top-level folder must exist
    expect(chain).toEqual(['Projecten']);
  });

  it('returns every ancestor folder in order for a deeply nested path', () => {
    // Given — a task note nested under project and taken folders
    const path = 'Projecten/Plugintest/taken/28-x.md';

    // When — its folder chain is computed
    const chain = folderChainForPath(path);

    // Then — each ancestor is listed from the root down
    expect(chain).toEqual([
      'Projecten',
      'Projecten/Plugintest',
      'Projecten/Plugintest/taken',
    ]);
  });

  it('yields no empty segments for an already-clean path', () => {
    // Given — a well-formed path with no trailing slash or double slashes
    const path = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

    // When — its folder chain is computed
    const chain = folderChainForPath(path);

    // Then — every entry is a real folder path, never an empty string
    expect(chain).toEqual([
      'Projecten',
      'Projecten/Acme Widgets',
      'Projecten/Acme Widgets/taken',
    ]);
    expect(chain.every((folder) => folder.length > 0)).toBe(true);
  });
});
