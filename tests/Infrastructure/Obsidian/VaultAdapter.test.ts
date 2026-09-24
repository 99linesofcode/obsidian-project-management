import { describe, expect, it, vi } from 'vitest';

// The adapter imports TFile from Obsidian, which has no runtime entry in the
// package (types only). Mock just that class so the adapter's event wiring can
// be exercised without the host app — the same hand-rolled vi.mock('obsidian')
// machinery the scheduler test already uses.
const { TFile } = vi.hoisted(() => {
  class TFile {
    constructor(
      public path: string,
      public extension: string,
    ) {}
  }
  return { TFile };
});

vi.mock('obsidian', () => ({ TFile }));

// The hoisted TFile is a value; this alias gives the instance type for the
// fake vault's annotations.
type TFileInstance = InstanceType<typeof TFile>;

import type { App, EventRef } from 'obsidian';
import { VaultAdapter } from '../../../src/Infrastructure/Obsidian/VaultAdapter.js';

// A fake vault that records the handlers the adapter subscribes and lets a
// test fire an event at them, so the adapter's filter and routing are what's
// under test.
class FakeVault {
  private readonly handlers = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();

  on(event: string, handler: (...args: unknown[]) => void): EventRef {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return {} as EventRef;
  }

  fire(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

function setup() {
  const vault = new FakeVault();
  const app = { vault } as unknown as App;
  const registered: EventRef[] = [];
  const adapter = new VaultAdapter(app, (ref) => registered.push(ref));
  const changed: string[] = [];
  const renamed: Array<{ oldPath: string; newPath: string }> = [];
  adapter.onNoteChanged((path) => changed.push(path));
  adapter.onNoteRenamed((oldPath, newPath) =>
    renamed.push({ oldPath, newPath }),
  );
  return { vault, registered, changed, renamed };
}

describe('VaultAdapter.onNoteChanged', () => {
  it('routes a created task note under Projecten through the change callback', () => {
    // Given — an adapter subscribed to note changes
    const { vault, changed } = setup();

    // When — a task note is created under Projecten
    vault.fire(
      'create',
      new TFile('Projecten/Acme Widgets/taken/42-fix-the-bug.md', 'md'),
    );

    // Then — the change callback receives the created note's path
    expect(changed).toEqual(['Projecten/Acme Widgets/taken/42-fix-the-bug.md']);
  });

  it('routes a modified task note under Projecten through the change callback', () => {
    // Given — an adapter subscribed to note changes
    const { vault, changed } = setup();

    // When — a task note is modified under Projecten
    vault.fire(
      'modify',
      new TFile('Projecten/Acme Widgets/taken/42-fix-the-bug.md', 'md'),
    );

    // Then — the change callback receives the modified note's path
    expect(changed).toEqual(['Projecten/Acme Widgets/taken/42-fix-the-bug.md']);
  });

  it('ignores created notes outside Projecten', () => {
    // Given — an adapter subscribed to note changes
    const { vault, changed } = setup();

    // When — a note outside Projecten is created
    vault.fire('create', new TFile('Notes/random.md', 'md'));

    // Then — the change callback is not invoked
    expect(changed).toEqual([]);
  });

  it('ignores created non-markdown files under Projecten', () => {
    // Given — an adapter subscribed to note changes
    const { vault, changed } = setup();

    // When — a non-markdown file is created under Projecten
    vault.fire(
      'create',
      new TFile('Projecten/Acme Widgets/board.canvas', 'canvas'),
    );

    // Then — the change callback is not invoked
    expect(changed).toEqual([]);
  });

  it('registers every subscription for cleanup on unload', () => {
    // Given — an adapter subscribed to note changes and renames
    const { registered } = setup();

    // When — the subscriptions are registered
    // Then — the modify, create and rename subscriptions are handed to the
    // plugin's registerEvent for cleanup
    expect(registered).toHaveLength(3);
  });
});

describe('VaultAdapter.onNoteRenamed', () => {
  it('routes a renamed task note under Projecten through the rename callback', () => {
    // Given — an adapter subscribed to note renames
    const { vault, renamed } = setup();

    // When — a task note under Projecten is renamed
    vault.fire(
      'rename',
      new TFile('Projecten/Acme Widgets/taken/42-fix-the-bug.md', 'md'),
      'Projecten/Acme Widgets/taken/42-old.md',
    );

    // Then — the callback receives both the old and the new path
    expect(renamed).toEqual([
      {
        oldPath: 'Projecten/Acme Widgets/taken/42-old.md',
        newPath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      },
    ]);
  });

  it('ignores renames outside Projecten', () => {
    // Given — an adapter subscribed to note renames
    const { vault, renamed } = setup();

    // When — a note outside Projecten is renamed
    vault.fire('rename', new TFile('Notes/random.md', 'md'), 'Notes/old.md');

    // Then — the callback is not invoked
    expect(renamed).toEqual([]);
  });

  it('ignores renamed non-markdown files under Projecten', () => {
    // Given — an adapter subscribed to note renames
    const { vault, renamed } = setup();

    // When — a non-markdown file is renamed under Projecten
    vault.fire(
      'rename',
      new TFile('Projecten/Acme Widgets/board.canvas', 'canvas'),
      'Projecten/Acme Widgets/old.canvas',
    );

    // Then — the callback is not invoked
    expect(renamed).toEqual([]);
  });
});

// A fake vault with a flat file list and a folder set, so the adapter's
// moveFolder can be exercised: it filters getFiles() by prefix, renames each
// through fileManager.renameFile, and creates destination folders as needed.
class MoveVault {
  files: TFileInstance[];
  folders = new Set<string>();
  renames: Array<{ from: string; to: string }> = [];

  constructor(paths: string[]) {
    this.files = paths.map(
      (path) => new TFile(path, path.split('.').pop() ?? ''),
    );
  }

  getFiles(): TFileInstance[] {
    return this.files;
  }

  getAbstractFileByPath(path: string): TFileInstance | null {
    return this.files.find((file) => file.path === path) ?? null;
  }

  getFolderByPath(path: string): unknown {
    return this.folders.has(path) ? {} : null;
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  fileManager = {
    renameFile: async (file: TFileInstance, newPath: string): Promise<void> => {
      this.renames.push({ from: file.path, to: newPath });
      file.path = newPath;
    },
  };
}

function moveSetup(paths: string[]) {
  const vault = new MoveVault(paths);
  const app = { vault, fileManager: vault.fileManager } as unknown as App;
  const adapter = new VaultAdapter(app, () => {});
  return { vault, adapter };
}

describe('VaultAdapter.moveFolder', () => {
  it('moves every file under the prefix, any extension, preserving relative paths', async () => {
    // Given — a project folder holding markdown, a .base file and an image,
    // plus a sibling project that must not move
    const { vault, adapter } = moveSetup([
      'Projecten/Acme Widgets/_home.md',
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
      'Projecten/Acme Widgets/board.base',
      'Projecten/Acme Widgets/images/diagram.png',
      'Projecten/Other/_home.md',
    ]);

    // When — the project folder is moved to the archive
    await adapter.moveFolder('Projecten/Acme Widgets', 'Archief/Acme Widgets');

    // Then — every file moved, its relative path intact, the sibling untouched
    expect(vault.files.map((file) => file.path).sort()).toEqual([
      'Archief/Acme Widgets/_home.md',
      'Archief/Acme Widgets/board.base',
      'Archief/Acme Widgets/images/diagram.png',
      'Archief/Acme Widgets/taken/42-fix-the-bug.md',
      'Archief/Acme Widgets/todos/fix-the-bug.md',
      'Projecten/Other/_home.md',
    ]);
  });

  it('creates the destination folder chain before renaming', async () => {
    // Given — a nested task note whose destination folders do not exist
    const { vault, adapter } = moveSetup([
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    ]);

    // When — the project folder is moved to the archive
    await adapter.moveFolder('Projecten/Acme Widgets', 'Archief/Acme Widgets');

    // Then — the whole destination chain was created
    expect(vault.folders.has('Archief')).toBe(true);
    expect(vault.folders.has('Archief/Acme Widgets')).toBe(true);
    expect(vault.folders.has('Archief/Acme Widgets/taken')).toBe(true);
  });

  it('is a no-op when no file lives under the prefix', async () => {
    // Given — a vault with no files under the source prefix
    const { vault, adapter } = moveSetup(['Projecten/Other/_home.md']);

    // When — the missing project folder is moved
    await adapter.moveFolder('Projecten/Acme Widgets', 'Archief/Acme Widgets');

    // Then — nothing is renamed
    expect(vault.renames).toEqual([]);
  });
});
