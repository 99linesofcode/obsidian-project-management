import { describe, expect, it, vi } from 'vitest';

const { TFile } = vi.hoisted(() => {
  class TFile {
    stat = { mtime: 0 };
    constructor(
      public path: string,
      public extension: string,
    ) {}
  }
  return { TFile };
});

vi.mock('obsidian', () => ({ TFile }));

type TFileInstance = InstanceType<typeof TFile>;

import type { App } from 'obsidian';
import { CanonicalFieldWrite } from '../../../src/core/port/data/CanonicalFieldWrite.js';
import { VaultAdapter } from '../../../src/infrastructure/vault/VaultAdapter.js';
import { vaultAdapter } from '../../helpers/vaultAdapter.js';

// NWM-3 — a `title` write renames the note to the rendered title within its
// folder. An unrenderable title is refused with an error naming it, never
// silently dropped and never an empty filename.

const NOTE_PATH = 'Projecten/Acme/taken/old-name.md';
const NOTE = ['---', 'labels: [type:task]', '---', 'Body text'].join('\n');

class FakeVault {
  private readonly notes = new Map<string, string>();

  seed(path: string, content: string): void {
    this.notes.set(path, content);
  }

  getAbstractFileByPath(path: string): TFileInstance | null {
    return this.notes.has(path) ? new TFile(path, 'md') : null;
  }

  async read(file: TFileInstance): Promise<string> {
    return this.notes.get(file.path)!;
  }

  has(path: string): boolean {
    return this.notes.has(path);
  }

  rename(from: string, to: string): void {
    const content = this.notes.get(from);
    if (content === undefined) {
      return;
    }
    this.notes.delete(from);
    this.notes.set(to, content);
  }
}

class FakeFileManager {
  readonly renamed: Array<{ from: string; to: string }> = [];

  constructor(private readonly vault: FakeVault) {}

  async renameFile(file: TFileInstance, newPath: string): Promise<void> {
    this.renamed.push({ from: file.path, to: newPath });
    this.vault.rename(file.path, newPath);
  }
}

function setup(): {
  vault: FakeVault;
  fileManager: FakeFileManager;
  adapter: VaultAdapter;
} {
  const vault = new FakeVault();
  const fileManager = new FakeFileManager(vault);
  const app = { vault, fileManager } as unknown as App;
  return { vault, fileManager, adapter: vaultAdapter(app) };
}

describe('NWM-3 — a title write renames to the rendered title', () => {
  it('renders the new title verbatim, colon as a space, case preserved', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: NOTE_PATH,
        field: 'title',
        value: 'Fix: a to-do twin',
      }),
    );

    expect(vault.has(NOTE_PATH)).toBe(false);
    expect(vault.has('Projecten/Acme/taken/Fix a to-do twin.md')).toBe(true);
  });

  it('refuses an unrenderable title, naming it', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE);

    await expect(
      adapter.applyField(
        new CanonicalFieldWrite({
          handle: NOTE_PATH,
          field: 'title',
          value: '...',
        }),
      ),
    ).rejects.toThrow('...');
    expect(vault.has(NOTE_PATH)).toBe(true);
  });

  it('refuses an empty title', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE);

    await expect(
      adapter.applyField(
        new CanonicalFieldWrite({
          handle: NOTE_PATH,
          field: 'title',
          value: '',
        }),
      ),
    ).rejects.toThrow();
    expect(vault.has(NOTE_PATH)).toBe(true);
  });
});
