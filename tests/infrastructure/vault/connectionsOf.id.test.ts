import { describe, expect, it } from 'vitest';
import { connectionsOf } from '../../../src/infrastructure/vault/connectionsOf.js';

// IDN-1 pins the note's own identity: `connections.vault: { tool: vault, id:
// <uuid> }`. The raw reader (`connectionsOf`) is the `connections` reader that
// survives the reconciliation of discovery's validated read with the chain's
// raw read, so it is where a note's id must read back. The entry shape is
// asserted through a structural cast because the interface gains `id` only with
// the implementation; the assertion itself is the pinned contract.
interface NoteIdEntry {
  tool?: string;
  id?: string;
}

function vaultEntry(content: string): NoteIdEntry | undefined {
  const connections = connectionsOf(content) as Record<string, NoteIdEntry>;
  return connections.vault;
}

function note(connectionLines: readonly string[]): string {
  return ['---', 'connections:', ...connectionLines, '---', ''].join('\n');
}

const uuid = '8f14e45f-ceea-4f6f-9c1e-2b3a4d5e6f70';

describe('IDN-1 — every note carries its own id at connections.vault.id', () => {
  it('reads the note back with its own id on the vault entry', () => {
    const content = note(['  vault:', '    tool: vault', `    id: ${uuid}`]);

    expect(vaultEntry(content)).toEqual({ tool: 'vault', id: uuid });
  });

  it('keeps the vault entry alongside a mirror entry, each carrying its own id', () => {
    const content = note([
      '  vault:',
      '    tool: vault',
      `    id: ${uuid}`,
      '  github:',
      '    tool: github',
      '    id: I_kwDOABCD',
    ]);

    expect(vaultEntry(content)?.id).toBe(uuid);
    const connections = connectionsOf(content) as Record<string, NoteIdEntry>;
    expect(connections.github?.id).toBe('I_kwDOABCD');
  });
});
