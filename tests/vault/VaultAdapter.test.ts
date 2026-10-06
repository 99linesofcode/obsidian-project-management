import { describe, expect, it, vi } from 'vitest';

// The adapter imports TFile from Obsidian, which has no runtime entry in the
// package (types only). Mock just that class so the adapter's event wiring can
// be exercised without the host app — the same hand-rolled vi.mock('obsidian')
// machinery the scheduler test already uses.
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

// The hoisted TFile is a value; this alias gives the instance type for the
// fake vault's annotations.
type TFileInstance = InstanceType<typeof TFile>;

import type { App, EventRef } from 'obsidian';
import { VaultAdapter } from '../../src/vault/VaultAdapter.js';

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

describe('DISC-1 — the vault port reads and writes notes', () => {
  it('routes a created task note under Projecten through the change callback', () => {
    const { vault, changed } = setup();

    vault.fire(
      'create',
      new TFile('Projecten/Acme Widgets/taken/42-fix-the-bug.md', 'md'),
    );

    expect(changed).toEqual(['Projecten/Acme Widgets/taken/42-fix-the-bug.md']);
  });

  it('routes a modified task note under Projecten through the change callback', () => {
    const { vault, changed } = setup();

    vault.fire(
      'modify',
      new TFile('Projecten/Acme Widgets/taken/42-fix-the-bug.md', 'md'),
    );

    expect(changed).toEqual(['Projecten/Acme Widgets/taken/42-fix-the-bug.md']);
  });

  it('ignores created notes outside Projecten', () => {
    const { vault, changed } = setup();

    vault.fire('create', new TFile('Notes/random.md', 'md'));

    expect(changed).toEqual([]);
  });

  it('ignores created non-markdown files under Projecten', () => {
    const { vault, changed } = setup();

    vault.fire(
      'create',
      new TFile('Projecten/Acme Widgets/board.canvas', 'canvas'),
    );

    expect(changed).toEqual([]);
  });

  it('registers every subscription for cleanup on unload', () => {
    const { registered } = setup();

    expect(registered).toHaveLength(3);
  });
});

describe('VaultAdapter.onNoteRenamed', () => {
  it('routes a renamed task note under Projecten through the rename callback', () => {
    const { vault, renamed } = setup();

    vault.fire(
      'rename',
      new TFile('Projecten/Acme Widgets/taken/42-fix-the-bug.md', 'md'),
      'Projecten/Acme Widgets/taken/42-old.md',
    );

    expect(renamed).toEqual([
      {
        oldPath: 'Projecten/Acme Widgets/taken/42-old.md',
        newPath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      },
    ]);
  });

  it('ignores renames outside Projecten', () => {
    const { vault, renamed } = setup();

    vault.fire('rename', new TFile('Notes/random.md', 'md'), 'Notes/old.md');

    expect(renamed).toEqual([]);
  });

  it('ignores renamed non-markdown files under Projecten', () => {
    const { vault, renamed } = setup();

    vault.fire(
      'rename',
      new TFile('Projecten/Acme Widgets/board.canvas', 'canvas'),
      'Projecten/Acme Widgets/old.canvas',
    );

    expect(renamed).toEqual([]);
  });
});

describe('VaultAdapter.modifiedTime', () => {
  it('returns the file mtime as ISO 8601 and null for an unknown path', async () => {
    const file = new TFile(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'md',
      { mtime: 1758196800000 },
    );
    const vault = {
      getAbstractFileByPath: (path: string) =>
        path === file.path ? file : null,
    };
    const app = { vault } as unknown as App;
    const adapter = new VaultAdapter(app, () => {});

    const iso = await adapter.modifiedTime(file.path);

    expect(iso).toBe(new Date(1758196800000).toISOString());
    expect(await adapter.modifiedTime('Projecten/missing.md')).toBeNull();
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
    const { vault, adapter } = moveSetup([
      'Projecten/Acme Widgets/_home.md',
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
      'Projecten/Acme Widgets/board.base',
      'Projecten/Acme Widgets/images/diagram.png',
      'Projecten/Other/_home.md',
    ]);

    await adapter.moveFolder('Projecten/Acme Widgets', 'Archief/Acme Widgets');

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
    const { vault, adapter } = moveSetup([
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    ]);

    await adapter.moveFolder('Projecten/Acme Widgets', 'Archief/Acme Widgets');

    expect(vault.folders.has('Archief')).toBe(true);
    expect(vault.folders.has('Archief/Acme Widgets')).toBe(true);
    expect(vault.folders.has('Archief/Acme Widgets/taken')).toBe(true);
  });

  it('is a no-op when no file lives under the prefix', async () => {
    const { vault, adapter } = moveSetup(['Projecten/Other/_home.md']);

    await adapter.moveFolder('Projecten/Acme Widgets', 'Archief/Acme Widgets');

    expect(vault.renames).toEqual([]);
  });
});

// A fake vault with a folder set and a file map, so createNote's mkdir -p
// chain can be exercised: Obsidian's create throws on a missing parent, so the
// adapter builds the chain first.
class CreateVault {
  folders = new Set<string>();
  files = new Map<string, string>();

  getFolderByPath(path: string): unknown {
    return this.folders.has(path) ? {} : null;
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  async create(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

function createSetup() {
  const vault = new CreateVault();
  const app = { vault } as unknown as App;
  const adapter = new VaultAdapter(app, () => {});
  return { vault, adapter };
}

describe('VaultAdapter.createNote', () => {
  it('creates the missing parent folder before writing the file', async () => {
    const { vault, adapter } = createSetup();

    await adapter.createNote('Templates/Task.md', 'starter');

    expect(vault.folders.has('Templates')).toBe(true);
    expect(vault.files.get('Templates/Task.md')).toBe('starter');
  });

  it('creates each level of a nested folder chain', async () => {
    const { vault, adapter } = createSetup();

    await adapter.createNote('Bases/My/Projects.base', 'x');

    expect([...vault.folders].sort()).toEqual(['Bases', 'Bases/My']);
  });
});

// A fake app with a file map and a fileManager, so trashNote's delegation to
// FileManager.trashFile (which respects the user's deletion preference) can be
// exercised.
class TrashVault {
  files: TFileInstance[];
  trashed: string[] = [];

  constructor(paths: string[]) {
    this.files = paths.map(
      (path) => new TFile(path, path.split('.').pop() ?? ''),
    );
  }

  getAbstractFileByPath(path: string): TFileInstance | null {
    return this.files.find((file) => file.path === path) ?? null;
  }

  fileManager = {
    trashFile: async (file: TFileInstance): Promise<void> => {
      this.trashed.push(file.path);
    },
  };
}

describe('VaultAdapter.trashNote', () => {
  it('delegates to FileManager.trashFile so the user preference is respected', async () => {
    const vault = new TrashVault([
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    ]);
    const app = { vault, fileManager: vault.fileManager } as unknown as App;
    const adapter = new VaultAdapter(app, () => {});

    await adapter.trashNote('Projecten/Acme Widgets/taken/42-fix-the-bug.md');

    expect(vault.trashed).toEqual([
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    ]);
  });

  it('is a no-op for an unknown path', async () => {
    const vault = new TrashVault([]);
    const app = { vault, fileManager: vault.fileManager } as unknown as App;
    const adapter = new VaultAdapter(app, () => {});

    await adapter.trashNote('Projecten/missing.md');

    expect(vault.trashed).toEqual([]);
  });
});
