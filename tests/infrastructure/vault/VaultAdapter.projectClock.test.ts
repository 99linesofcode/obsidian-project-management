import { describe, expect, it, vi } from 'vitest';

// The vault test double here models a file's change time (`ctime`) alongside
// its modified time (`mtime`). `tests/helpers/fakeVault.ts` is the VaultPort
// double and models no file stats at all, so the `ctime` support belongs on the
// TFile double this test drives the real VaultAdapter with.
const { TFile } = vi.hoisted(() => {
  class TFile {
    stat: { mtime: number; ctime: number };
    constructor(
      public path: string,
      public extension: string,
      stat?: { mtime: number; ctime: number },
    ) {
      this.stat = stat ?? { mtime: 0, ctime: 0 };
    }
  }
  return { TFile };
});

vi.mock('obsidian', () => ({ TFile }));

type TFileInstance = InstanceType<typeof TFile>;

import type { App } from 'obsidian';
import { vaultAdapter } from '../../helpers/vaultAdapter.js';

const HOME_PATH = 'Projecten/Acme/_Acme.md';
const PROJECT = 'Acme';
// A folder move rewrites the note's ctime and leaves its mtime byte-identical.
const MTIME = Date.parse('2026-10-08T10:00:00Z');
const CTIME = Date.parse('2026-10-08T12:00:00Z');

class FakeAppVault {
  private readonly notes = new Map<
    string,
    { content: string; mtime: number; ctime: number }
  >();
  readonly frontmatter = new Map<string, Record<string, unknown>>();

  readonly metadataCache = {
    getFileCache: (file: { path: string }) => ({
      frontmatter: this.frontmatter.get(file.path),
    }),
  };

  seed(path: string, content: string, mtime: number, ctime: number): void {
    this.notes.set(path, { content, mtime, ctime });
  }

  getAbstractFileByPath(path: string): TFileInstance | null {
    const note = this.notes.get(path);
    if (note === undefined) {
      return null;
    }
    return new TFile(path, 'md', { mtime: note.mtime, ctime: note.ctime });
  }

  getMarkdownFiles(): TFileInstance[] {
    return [...this.notes.entries()].map(
      ([path, note]) =>
        new TFile(path, 'md', { mtime: note.mtime, ctime: note.ctime }),
    );
  }

  getFolderByPath(): object | null {
    return {};
  }

  async createFolder(): Promise<void> {}

  async read(file: TFileInstance): Promise<string> {
    return this.notes.get(file.path)!.content;
  }

  has(path: string): boolean {
    return this.notes.has(path);
  }
}

function setup(): { vault: FakeAppVault; adapter: ReturnType<typeof vaultAdapter> } {
  const vault = new FakeAppVault();
  vault.seed(
    HOME_PATH,
    ['---', 'type: project', '---'].join('\n'),
    MTIME,
    CTIME,
  );
  vault.frontmatter.set(HOME_PATH, {
    type: 'project',
    connections: { conformance: { tool: 'conformance', project: 'board-1' } },
  });
  const app = {
    vault,
    metadataCache: vault.metadataCache,
  } as unknown as App;
  return {
    vault,
    adapter: vaultAdapter(app, {
      registeredApplications: new Set(['conformance']),
    }),
  };
}

describe('NWM-6 / NWM-28 — the vault archive clock is the home note ctime', () => {
  it('reports the home note change time, not its modified time', async () => {
    // The move that archives the project rewrites ctime and leaves mtime
    // untouched, so an mtime clock would be stale on every archive.
    const { adapter } = setup();

    const observed = await adapter.observeProject(PROJECT);

    expect(observed.fieldTime).toBe(new Date(CTIME).toISOString());
    expect(observed.fieldTime).not.toBe(new Date(MTIME).toISOString());
  });
});
