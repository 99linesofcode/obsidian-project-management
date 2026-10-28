import { describe, expect, it, vi } from 'vitest';

const { TFile } = vi.hoisted(() => {
  class TFile {
    stat: { mtime: number };
    constructor(
      public path: string,
      public extension: string,
      stat?: { mtime: number },
    ) {
      this.stat = stat ?? { mtime: 0 };
    }
  }
  return { TFile };
});

vi.mock('obsidian', () => ({ TFile }));

type TFileInstance = InstanceType<typeof TFile>;

import type { App } from 'obsidian';
import type { VaultAdapter } from '../../../src/infrastructure/vault/VaultAdapter.js';
import { connectionsOf } from '../../../src/infrastructure/vault/connectionsOf.js';
import { vaultAdapter } from '../../helpers/vaultAdapter.js';

class FakeAppVault {
  private readonly notes = new Map<string, string>();

  readonly metadataCache = {
    getFileCache: (file: { path: string }) => ({
      frontmatter: {
        connections: connectionsOf(this.notes.get(file.path) ?? ''),
      },
    }),
  };

  seed(path: string, content: string): void {
    this.notes.set(path, content);
  }

  getAbstractFileByPath(path: string): TFileInstance | null {
    const content = this.notes.get(path);
    return content === undefined ? null : new TFile(path, 'md');
  }

  getMarkdownFiles(): TFileInstance[] {
    return [...this.notes.keys()].map((path) => new TFile(path, 'md'));
  }

  async read(file: TFileInstance): Promise<string> {
    return this.notes.get(file.path)!;
  }
}

function source(notes: FakeAppVault): VaultAdapter {
  const app = {
    vault: notes,
    metadataCache: notes.metadataCache,
  } as unknown as App;
  return vaultAdapter(app, {
    registeredApplications: new Set(['conformance']),
  });
}

const HOME = [
  '---',
  'type: project',
  'connections:',
  '  vault:',
  '    tool: vault',
  '    id: Acme',
  '  conformance:',
  '    tool: conformance',
  '    project: board-1',
  '  second:',
  '    tool: conformance',
  '    project: board-2',
  '---',
].join('\n');

describe('VaultAdapter — the project source', () => {
  it('reads the declared connections as slugged application/target envelopes', async () => {
    const notes = new FakeAppVault();
    notes.seed('Projecten/Acme/_Acme.md', HOME);

    const connections = await source(notes).readConnections('Acme');

    expect(connections).toEqual([
      { slug: 'conformance', application: 'conformance', target: 'board-1' },
      { slug: 'second', application: 'conformance', target: 'board-2' },
    ]);
  });

  it.each([
    'Projecten/Acme/_home.md',
    'Projecten/Acme/Acme.md',
    'Projecten/Acme/home.md',
  ])(
    'scopes the connections of a legacy-named home note at %s',
    async (homePath) => {
      const notes = new FakeAppVault();
      notes.seed(homePath, HOME);

      const connections = await source(notes).readConnections('Acme');

      expect(connections).toHaveLength(2);
      expect(connections[0]?.slug).toBe('conformance');
      expect(connections[0]?.application).toBe('conformance');
      expect(connections[0]?.target).toBe('board-1');
    },
  );

  it('returns no connections when the project note is absent', async () => {
    expect(await source(new FakeAppVault()).readConnections('Missing')).toEqual(
      [],
    );
  });

  it('enumerates the project task notes', async () => {
    const notes = new FakeAppVault();
    notes.seed('Projecten/Acme/_Acme.md', HOME);
    notes.seed('Projecten/Acme/taken/fix.md', '');
    notes.seed('Projecten/Acme/taken/ship.md', '');
    notes.seed('Projecten/Acme/todos/other.md', '');

    expect(await source(notes).listEntities('Acme')).toEqual([
      'Projecten/Acme/taken/fix.md',
      'Projecten/Acme/taken/ship.md',
    ]);
  });
});
