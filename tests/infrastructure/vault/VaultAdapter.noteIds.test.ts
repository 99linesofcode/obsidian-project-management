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
import { connectionsOf } from '../../../src/infrastructure/vault/connectionsOf.js';
import { vaultAdapter } from '../../helpers/vaultAdapter.js';

// IDN-3's mechanism is the pinned port method `readNoteIds()`: it enumerates
// every note under `Projecten/` and `Archief/` and returns each note's own id
// with its path. The method is pinned by the delta but not yet on the port, so
// the assertion is written against the pinned shape; until the implementation
// lands this test fails because the surface does not exist yet.
interface NoteIdsReader {
  readNoteIds(): Promise<readonly { id: string; path: string }[]>;
}

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

function source(notes: FakeAppVault): NoteIdsReader {
  const app = {
    vault: notes,
    metadataCache: notes.metadataCache,
  } as unknown as App;
  return vaultAdapter(app, {
    registeredApplications: new Set(['conformance']),
  }) as unknown as NoteIdsReader;
}

function noteWithId(id: string): string {
  return [
    '---',
    'connections:',
    '  vault:',
    '    tool: vault',
    `    id: ${id}`,
    '---',
  ].join('\n');
}

describe('IDN-3 — readNoteIds enumerates every note by its own id', () => {
  it('returns each note under Projecten and Archief with its id', async () => {
    const notes = new FakeAppVault();
    notes.seed('Projecten/Acme/taken/one.md', noteWithId('id-one'));
    notes.seed('Archief/Beta/taken/two.md', noteWithId('id-two'));

    const ids = await source(notes).readNoteIds();

    expect(ids).toEqual([
      { id: 'id-one', path: 'Projecten/Acme/taken/one.md' },
      { id: 'id-two', path: 'Archief/Beta/taken/two.md' },
    ]);
  });
});
