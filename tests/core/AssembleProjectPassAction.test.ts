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
import { AssembleProjectPassAction } from '../../src/core/AssembleProjectPassAction.js';
import { AdapterRegistration } from '../../src/core/data/AdapterRegistration.js';
import { CanonicalTask } from '../../src/core/data/CanonicalTask.js';
import { registerAdapters } from '../../src/core/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../src/infrastructure/fake/conformanceDescriptor.js';
import { CoreBaselineStoreAdapter } from '../../src/infrastructure/registry/CoreBaselineStoreAdapter.js';
import { VaultOriginAdapter } from '../../src/infrastructure/vault/VaultOriginAdapter.js';
import { VaultProjectSourceAdapter } from '../../src/infrastructure/vault/VaultProjectSourceAdapter.js';
import { VaultAdapter } from '../../src/vault/VaultAdapter.js';

const PROJECT = 'Acme';
const HOME_PATH = 'Projecten/Acme/_Acme.md';
const TASK_PATH = 'Projecten/Acme/taken/fix-the-bug.md';
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

const TASK = [
  '---',
  'categories: [taken]',
  'type: task',
  'status: Done',
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

  getMarkdownFiles(): TFileInstance[] {
    return [...this.notes.entries()].map(
      ([path, note]) => new TFile(path, 'md', { mtime: note.mtime }),
    );
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
  constructor(private readonly vault: FakeVault) {}

  async trashFile(file: TFileInstance): Promise<void> {
    this.vault.remove(file.path);
  }

  async renameFile(file: TFileInstance, newPath: string): Promise<void> {
    this.vault.rename(file.path, newPath);
  }
}

function fakeStorage() {
  let data: Record<string, unknown> = {};
  return {
    storage: {
      async load() {
        return data;
      },
      async save(next: unknown) {
        data = next as Record<string, unknown>;
      },
    },
    snapshot: () => data,
  };
}

function mirrorTask(status: string, body: string): CanonicalTask {
  return new CanonicalTask({
    handle: TASK_PATH,
    entityId: TASK_PATH,
    title: 'fix the bug',
    body,
    status,
    completed: false,
    parent: null,
    labels: ['alpha', 'beta'],
  });
}

function setup() {
  const vault = new FakeVault();
  vault.seed(HOME_PATH, HOME, MTIME);
  vault.seed(TASK_PATH, TASK, MTIME);
  const fileManager = new FakeFileManager(vault);
  const app = { vault, fileManager } as unknown as App;

  const origin = new VaultOriginAdapter(app);
  const projectSource = new VaultProjectSourceAdapter(
    new VaultAdapter(app, () => {}),
  );

  const mirror = new ConformanceMirrorAdapter();
  mirror.seed(mirrorTask('Building', 'Mirror body'));
  mirror.setFieldTime(TASK_PATH, 'body', '2026-10-08T11:00:00Z');
  const adapters = registerAdapters([
    new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
  ]).adapters;

  const { storage, snapshot } = fakeStorage();
  const baselines = new CoreBaselineStoreAdapter(storage);
  const action = new AssembleProjectPassAction(
    projectSource,
    origin,
    baselines,
    adapters,
  );

  return { vault, mirror, baselines, action, snapshot };
}

describe('AssembleProjectPassAction — a project pass end to end (F02 NWM-1, NWM-3)', () => {
  it('reconciles every field of the entity across the origin and the mirror', async () => {
    const { vault, mirror, action } = setup();

    const records = await action.invoke(PROJECT);

    const status = records.find((record) => record.field === 'Status')!;
    expect(status.result.value).toBe('Done');
    expect(mirror.currentTask(TASK_PATH)?.status).toBe('Done');

    const body = records.find((record) => record.field === 'body')!;
    expect(body.result.value).toBe('Mirror body');
    expect(vault.content(TASK_PATH)).toContain('Mirror body');
  });

  it('persists the advanced baselines and round-trips them', async () => {
    const { baselines, action, snapshot } = setup();

    await action.invoke(PROJECT);

    const originStatus = await baselines.read(TASK_PATH, 'Status', 'origin');
    const mirrorStatus = await baselines.read(
      TASK_PATH,
      'Status',
      'conformance',
    );
    expect(originStatus?.value).toBe('Done');
    expect(mirrorStatus?.value).toBe('Done');

    const syncState = snapshot()['syncState'] as Record<string, unknown>;
    expect(syncState['coreBaselines']).toBeDefined();
  });

  it('writes nothing on a second pass when nothing changed (NWM-24)', async () => {
    const { mirror, action } = setup();
    await action.invoke(PROJECT);

    const second = await action.invoke(PROJECT);

    expect(second.every((record) => record.written.length === 0)).toBe(true);
    expect(second.every((record) => record.advanced.length === 0)).toBe(true);
    expect(mirror.currentTask(TASK_PATH)?.status).toBe('Done');
  });
});
