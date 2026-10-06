import { describe, expect, it } from 'vitest';
import { folderChainForPath } from '../../src/vault/folderChainForPath.js';

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
