import { describe, expect, it, vi } from 'vitest';

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

import type { App, EventRef } from 'obsidian';
import { vaultAdapter } from '../../helpers/vaultAdapter.js';

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
  const adapter = vaultAdapter(app, { registerEvent: (ref) => registered.push(ref) });
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

describe('VaultAdapter.observeProject', () => {
  it('reads the home note change time as the field time and reports an absent project as no value', async () => {
    const homePath = 'Projecten/Acme Widgets/_Acme Widgets.md';
    const mtime = 1758196800000;
    const ctime = 1758200400000;
    const vault = {
      getMarkdownFiles: () => [new TFile(homePath, 'md', { mtime, ctime })],
      getAbstractFileByPath: (path: string) =>
        path === homePath ? new TFile(path, 'md', { mtime, ctime }) : null,
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            connections: { a: { tool: 'conformance', project: 'board' } },
          },
        }),
      },
    };
    const app = {
      vault,
      metadataCache: vault.metadataCache,
    } as unknown as App;
    const adapter = vaultAdapter(app, {
      registeredApplications: new Set(['conformance']),
    });

    const observed = await adapter.observeProject('Acme Widgets');
    const missing = await adapter.observeProject('Missing');

    expect(observed.fieldTime).toBe(new Date(ctime).toISOString());
    expect(observed.current).toBe('false');
    expect(missing.fieldTime).toBeNull();
  });
});

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
  const adapter = vaultAdapter(app);
  return { vault, adapter };
}

describe('VaultAdapter.applyProjectArchived', () => {
  it('moves every file under the prefix, any extension, preserving relative paths', async () => {
    const { vault, adapter } = moveSetup([
      'Projecten/Acme Widgets/_home.md',
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
      'Projecten/Acme Widgets/board.base',
      'Projecten/Acme Widgets/images/diagram.png',
      'Projecten/Other/_home.md',
    ]);

    await adapter.applyProjectArchived('Acme Widgets', true);

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

    await adapter.applyProjectArchived('Acme Widgets', true);

    expect(vault.folders.has('Archief')).toBe(true);
    expect(vault.folders.has('Archief/Acme Widgets')).toBe(true);
    expect(vault.folders.has('Archief/Acme Widgets/taken')).toBe(true);
  });

  it('is a no-op when no file lives under the prefix', async () => {
    const { vault, adapter } = moveSetup(['Projecten/Other/_home.md']);

    await adapter.applyProjectArchived('Acme Widgets', true);

    expect(vault.renames).toEqual([]);
  });
});

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
  const adapter = vaultAdapter(app);
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
    const adapter = vaultAdapter(app);

    await adapter.trashNote('Projecten/Acme Widgets/taken/42-fix-the-bug.md');

    expect(vault.trashed).toEqual([
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    ]);
  });

  it('is a no-op for an unknown path', async () => {
    const vault = new TrashVault([]);
    const app = { vault, fileManager: vault.fileManager } as unknown as App;
    const adapter = vaultAdapter(app);

    await adapter.trashNote('Projecten/missing.md');

    expect(vault.trashed).toEqual([]);
  });
});
