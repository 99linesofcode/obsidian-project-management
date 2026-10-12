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
import { Baseline } from '../../../src/core/domain/Baseline.js';
import { CanonicalFieldWrite } from '../../../src/core/port/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../../src/core/port/data/CanonicalTask.js';
import { MirrorSyncAction } from '../../../src/core/application/actions/MirrorSyncAction.js';
import { ConformanceMirrorAdapter } from '../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { SyncStateAdapter } from '../../../src/infrastructure/registry/SyncStateAdapter.js';
import { VaultAdapter } from '../../../src/infrastructure/vault/VaultAdapter.js';
import { vaultAdapter } from '../../helpers/vaultAdapter.js';

const NOTE_PATH = 'Projecten/Acme/taken/fix-the-bug.md';
const HOME_PATH = 'Projecten/Acme/_Acme.md';
const MTIME = Date.parse('2026-10-08T10:00:00Z');
const HOME = [
  '---',
  'type: project',
  'connections:',
  '  conformance:',
  '    tool: conformance',
  '    project: board-1',
  '---',
].join('\n');
const NOTE = [
  '---',
  'categories: [taken]',
  'type: task',
  'status: Building',
  'affiliation: ["[[_Acme]]", "[[Slice]]"]',
  'created: 2026-01-01',
  'synced: 2026-01-02',
  'completed: 2026-01-03',
  'labels: alpha, beta',
  '---',
  'Body text',
].join('\n');

class FakeVault {
  private readonly notes = new Map<
    string,
    { content: string; mtime: number }
  >();
  readonly frontmatter = new Map<string, Record<string, unknown>>();

  readonly metadataCache = {
    getFileCache: (file: { path: string }) => ({
      frontmatter: this.frontmatter.get(file.path),
    }),
  };

  seed(path: string, content: string, mtime: number): void {
    this.notes.set(path, { content, mtime });
  }

  getAbstractFileByPath(path: string): TFileInstance | null {
    const note = this.notes.get(path);
    if (note === undefined) {
      return null;
    }
    return new TFile(path, 'md', { mtime: note.mtime });
  }

  getMarkdownFiles(): TFileInstance[] {
    return [...this.notes.entries()].map(
      ([path, note]) => new TFile(path, 'md', { mtime: note.mtime }),
    );
  }

  getFolderByPath(): object | null {
    return {};
  }

  async createFolder(): Promise<void> {}

  async read(file: TFileInstance): Promise<string> {
    return this.notes.get(file.path)!.content;
  }

  async modify(file: TFileInstance, content: string): Promise<void> {
    const note = this.notes.get(file.path)!;
    this.notes.set(file.path, { ...note, content });
  }

  content(path: string): string | null {
    return this.notes.get(path)?.content ?? null;
  }

  has(path: string): boolean {
    return this.notes.has(path);
  }

  remove(path: string): void {
    this.notes.delete(path);
  }

  rename(from: string, to: string): void {
    const note = this.notes.get(from);
    if (note === undefined) {
      return;
    }
    this.notes.delete(from);
    this.notes.set(to, note);
  }
}

class FakeFileManager {
  readonly trashed: string[] = [];
  readonly renamed: Array<{ from: string; to: string }> = [];

  constructor(private readonly vault: FakeVault) {}

  async trashFile(file: TFileInstance): Promise<void> {
    this.trashed.push(file.path);
    this.vault.remove(file.path);
  }

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
  const app = {
    vault,
    fileManager,
    metadataCache: vault.metadataCache,
  } as unknown as App;
  return {
    vault,
    fileManager,
    adapter: vaultAdapter(app, {
      registeredApplications: new Set(['conformance']),
    }),
  };
}

function memoryStorage() {
  let data: Record<string, unknown> = {};
  return {
    async load() {
      return data;
    },
    async save(next: unknown) {
      data = next as Record<string, unknown>;
    },
  };
}

async function seedOrigin(
  vault: FakeVault,
  registry: SyncStateAdapter,
  statusBaseline: string,
): Promise<void> {
  vault.seed(HOME_PATH, HOME, MTIME);
  vault.frontmatter.set(HOME_PATH, {
    type: 'project',
    connections: { conformance: { tool: 'conformance', project: 'board-1' } },
  });
  await registry.setEntity({ id: NOTE_PATH, notePath: NOTE_PATH });
  await registry.setMirrorItem('Acme', 'conformance', NOTE_PATH, {
    entityId: NOTE_PATH,
  });
  await registry.writeBaseline(
    NOTE_PATH,
    'Status',
    'origin',
    new Baseline(statusBaseline, false),
  );
  await registry.writeBaseline(
    NOTE_PATH,
    'Status',
    'mirror:conformance',
    new Baseline(statusBaseline, false),
  );
}

function mirrorTask(status: string): CanonicalTask {
  return new CanonicalTask({
    handle: NOTE_PATH,
    entityId: NOTE_PATH,
    title: 'Task',
    body: '',
    status,
    completed: false,
    parent: null,
    labels: [],
  });
}

describe('VaultAdapter origin — the origin read (F02 NWM-28)', () => {
  it('reads each canonical field and the note mtime as the field time', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);

    const title = await adapter.observe(NOTE_PATH, 'title');
    const status = await adapter.observe(NOTE_PATH, 'Status');
    const body = await adapter.observe(NOTE_PATH, 'body');
    const completion = await adapter.observe(NOTE_PATH, 'completion');
    const parent = await adapter.observe(NOTE_PATH, 'subtasks');
    const label = await adapter.observe(NOTE_PATH, 'label');

    expect(title.current).toBe('fix the bug');
    expect(status.current).toBe('Building');
    expect(body.current).toBe('Body text');
    expect(completion.current).toBe('true');
    expect(completion.currentCompleted).toBe(true);
    expect(parent.current).toBe('Slice');
    expect(label.current).toBe('alpha,beta');

    expect(status.fieldTime).toBe(new Date(MTIME).toISOString());
    expect(status.trustworthy).toBe(true);
  });

  it('reports an absent note as no value', async () => {
    const { adapter } = setup();

    const observed = await adapter.observe(
      'Projecten/Acme/taken/gone.md',
      'Status',
    );

    expect(observed.current).toBeNull();
    expect(observed.fieldTime).toBeNull();
  });

  it('reads the whole note as the canonical task for materialization', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);

    const task = await adapter.readTask(NOTE_PATH);

    expect(task).toEqual(
      new CanonicalTask({
        handle: NOTE_PATH,
        entityId: NOTE_PATH,
        title: 'fix the bug',
        body: 'Body text',
        status: 'Building',
        completed: true,
        parent: null,
        labels: ['alpha', 'beta'],
      }),
    );
  });

  it('reports a note without a type as no task', async () => {
    const { vault, adapter } = setup();
    vault.seed(
      NOTE_PATH,
      ['---', 'status: Building', '---', 'Body text'].join('\n'),
      MTIME,
    );

    expect(await adapter.readTask(NOTE_PATH)).toBeNull();
  });

  it('reports an absent note as no task', async () => {
    const { adapter } = setup();

    expect(await adapter.readTask('Projecten/Acme/taken/gone.md')).toBeNull();
  });
});

describe('VaultAdapter origin — the origin write (F02 NWM-3)', () => {
  it('writes a canonical field back into the note, preserving the body', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: NOTE_PATH,
        field: 'Status',
        value: 'Done',
      }),
    );

    expect(vault.content(NOTE_PATH)).toContain('status: Done');
    expect(vault.content(NOTE_PATH)).toContain('Body text');
  });

  it('fails when the note is missing instead of reporting a durable write', async () => {
    const { adapter } = setup();

    await expect(
      adapter.applyField(
        new CanonicalFieldWrite({
          handle: 'Projecten/Acme/taken/gone.md',
          field: 'Status',
          value: 'Done',
        }),
      ),
    ).rejects.toThrow();
  });

  it('fails when the note has no frontmatter instead of skipping silently', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, 'Body text', MTIME);

    await expect(
      adapter.applyField(
        new CanonicalFieldWrite({
          handle: NOTE_PATH,
          field: 'Status',
          value: 'Done',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('VaultAdapter origin — the origin rename (F02 NWM-3)', () => {
  it('renames a nested note within its folder', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: NOTE_PATH,
        field: 'title',
        value: 'Fix it now',
      }),
    );

    expect(vault.has(NOTE_PATH)).toBe(false);
    expect(vault.has('Projecten/Acme/taken/fix-it-now.md')).toBe(true);
  });

  it('renames a root-level note without dropping its last character', async () => {
    const { vault, adapter } = setup();
    vault.seed('fix-the-bug.md', NOTE, MTIME);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'fix-the-bug.md',
        field: 'title',
        value: 'Fix it now',
      }),
    );

    expect(vault.has('fix-the-bug.md')).toBe(false);
    expect(vault.has('fix-it-now.md')).toBe(true);
  });

  it('refuses to rename a note to an empty slug', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);

    await expect(
      adapter.applyField(
        new CanonicalFieldWrite({
          handle: NOTE_PATH,
          field: 'title',
          value: '!!!',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('VaultAdapter origin — the origin delete (F02 NWM-25)', () => {
  it('trashes the note rather than destroying it', async () => {
    const { vault, fileManager, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);

    await adapter.trashNote(NOTE_PATH);

    expect(fileManager.trashed).toEqual([NOTE_PATH]);
    expect(vault.has(NOTE_PATH)).toBe(false);
  });
});

describe('VaultAdapter origin — the origin round-trip (F02 NWM-3, NWM-17)', () => {
  it('updates the note through the action and advances the origin baseline', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(mirrorTask('Review'));
    const registry = new SyncStateAdapter(memoryStorage());
    await seedOrigin(vault, registry, 'Building');
    const action = new MirrorSyncAction(adapter, registry, {
      create: () => mirror,
    });

    const records = await action.invoke('Acme');
    const status = records.find((record) => record.field === 'Status')!;

    expect(vault.content(NOTE_PATH)).toContain('status: Review');
    expect(status.advanced).toContain('origin');
    expect(status.advanced).toContain('mirror:conformance');
  });
});

describe('VaultAdapter origin — the origin timestamp reaches the merge (F02 NWM-6, NWM-28)', () => {
  it("wins the decisive-timestamp rung with the note's mtime", async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(mirrorTask('Review'));
    mirror.setFieldTime(NOTE_PATH, 'Status', '2026-10-08T09:00:00Z');
    const registry = new SyncStateAdapter(memoryStorage());
    await seedOrigin(vault, registry, 'Todo');

    const observed = await adapter.observe(NOTE_PATH, 'Status');
    const action = new MirrorSyncAction(adapter, registry, {
      create: () => mirror,
    });

    const records = await action.invoke('Acme');
    const status = records.find((record) => record.field === 'Status')!;

    expect(observed.fieldTime).toBe(new Date(MTIME).toISOString());
    expect(status.result.rung).toBe(1);
    expect(status.result.winner).toBe('origin');
    expect(status.result.value).toBe('Building');
    expect(mirror.currentTask(NOTE_PATH)?.status).toBe('Building');
  });
});
