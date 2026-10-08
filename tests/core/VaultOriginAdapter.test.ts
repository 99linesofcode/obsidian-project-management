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
import { AdapterRegistration } from '../../src/core/data/AdapterRegistration.js';
import { Baseline } from '../../src/core/data/Baseline.js';
import { CanonicalFieldWrite } from '../../src/core/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../src/core/data/CanonicalTask.js';
import { MirrorSide } from '../../src/core/data/MirrorSide.js';
import { MirrorSyncPass } from '../../src/core/data/MirrorSyncPass.js';
import { SideObservation } from '../../src/core/data/SideObservation.js';
import { MirrorSyncAction } from '../../src/core/MirrorSyncAction.js';
import { registerAdapters } from '../../src/core/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../src/infrastructure/fake/conformanceDescriptor.js';
import { VaultOriginAdapter } from '../../src/infrastructure/vault/VaultOriginAdapter.js';
import { originSideObservation } from '../../src/core/originSideObservation.js';

const NOTE_PATH = 'Projecten/Acme/taken/fix-the-bug.md';
const MTIME = Date.parse('2026-10-08T10:00:00Z');
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
  adapter: VaultOriginAdapter;
} {
  const vault = new FakeVault();
  const fileManager = new FakeFileManager(vault);
  const app = { vault, fileManager } as unknown as App;
  return { vault, fileManager, adapter: new VaultOriginAdapter(app) };
}

describe('VaultOriginAdapter — the origin read (F02 NWM-28)', () => {
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
});

describe('VaultOriginAdapter — the origin write (F02 NWM-3)', () => {
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

describe('VaultOriginAdapter — the origin rename (F02 NWM-3)', () => {
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

describe('VaultOriginAdapter — the origin delete (F02 NWM-25)', () => {
  it('trashes the note rather than destroying it', async () => {
    const { vault, fileManager, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);

    await adapter.trash(NOTE_PATH);

    expect(fileManager.trashed).toEqual([NOTE_PATH]);
    expect(vault.has(NOTE_PATH)).toBe(false);
  });
});

describe('VaultOriginAdapter — the origin round-trip (F02 NWM-3, NWM-17)', () => {
  it('updates the note through the action and advances the origin baseline', async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(
      new CanonicalTask({
        handle: NOTE_PATH,
        entityId: NOTE_PATH,
        title: 'Task',
        body: '',
        status: 'Review',
        completed: false,
        parent: null,
        labels: [],
      }),
    );
    const registered = registerAdapters([
      new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
    ]).adapters.get('conformance')!;

    const pass = new MirrorSyncPass({
      entityId: NOTE_PATH,
      field: 'Status',
      origin: new SideObservation({
        side: 'vault',
        role: 'origin',
        current: 'Building',
        baseline: new Baseline('Building', false),
        fieldTime: null,
        timestampTrustworthy: true,
        completeFetch: true,
        currentCompleted: false,
      }),
      mirrors: [
        new MirrorSide({
          side: 'conformance',
          handle: NOTE_PATH,
          adapter: registered,
        }),
      ],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction(adapter).invoke(pass);

    expect(vault.content(NOTE_PATH)).toContain('status: Review');
    expect(record.advanced).toContain('vault');
    expect(record.advanced).toContain('conformance');
  });
});

describe('VaultOriginAdapter — the origin timestamp reaches the merge (F02 NWM-6, NWM-28)', () => {
  it("wins the decisive-timestamp rung with the note's mtime", async () => {
    const { vault, adapter } = setup();
    vault.seed(NOTE_PATH, NOTE, MTIME);
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(
      new CanonicalTask({
        handle: NOTE_PATH,
        entityId: NOTE_PATH,
        title: 'Task',
        body: '',
        status: 'Review',
        completed: false,
        parent: null,
        labels: [],
      }),
    );
    mirror.setFieldTime(NOTE_PATH, 'Status', '2026-10-08T09:00:00Z');
    const registered = registerAdapters([
      new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
    ]).adapters.get('conformance')!;

    const observed = await adapter.observe(NOTE_PATH, 'Status');
    const pass = new MirrorSyncPass({
      entityId: NOTE_PATH,
      field: 'Status',
      origin: originSideObservation(
        'vault',
        new Baseline('Todo', false),
        observed,
      ),
      mirrors: [
        new MirrorSide({
          side: 'conformance',
          handle: NOTE_PATH,
          adapter: registered,
        }),
      ],
      baselines: new Map([['conformance', new Baseline('Todo', false)]]),
    });

    const record = await new MirrorSyncAction(adapter).invoke(pass);

    expect(observed.fieldTime).toBe(new Date(MTIME).toISOString());
    expect(record.result.rung).toBe(1);
    expect(record.result.winner).toBe('vault');
    expect(record.result.value).toBe('Building');
    expect(mirror.currentTask(NOTE_PATH)?.status).toBe('Building');
  });
});
