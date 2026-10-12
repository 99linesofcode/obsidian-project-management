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
import { AssembleProjectPassAction } from '../../../../src/core/application/actions/AssembleProjectPassAction.js';
import { AdapterRegistration } from '../../../../src/core/application/data/AdapterRegistration.js';
import { CanonicalTask } from '../../../../src/core/application/data/CanonicalTask.js';
import type { RegisteredAdapter } from '../../../../src/core/application/data/RegisteredAdapter.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { registerAdapters } from '../../../../src/core/application/services/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../../../src/infrastructure/fake/conformanceDescriptor.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';
import { vaultAdapter } from '../../../helpers/vaultAdapter.js';

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
  readonly frontmatter = new Map<string, unknown>();

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

async function setup() {
  const vault = new FakeVault();
  vault.seed(HOME_PATH, HOME, MTIME);
  vault.seed(TASK_PATH, TASK, MTIME);
  vault.frontmatter.set(HOME_PATH, {
    connections: { conformance: { tool: 'conformance', project: 'board-1' } },
  });
  const fileManager = new FakeFileManager(vault);
  const app = {
    vault,
    fileManager,
    metadataCache: vault.metadataCache,
  } as unknown as App;

  const vaultPort = vaultAdapter(app);

  const mirror = new ConformanceMirrorAdapter();
  mirror.seed(mirrorTask('Building', 'Mirror body'));
  mirror.setFieldTime(TASK_PATH, 'body', '2026-10-08T11:00:00Z');
  const registered = registerAdapters([
    new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
  ]).adapters.get('conformance')!;

  const mirrorAdapters: MirrorAdapterFactoryPort = {
    create: (application): RegisteredAdapter | null =>
      application === 'conformance' ? registered : null,
  };

  const { storage, snapshot } = fakeStorage();
  const registry = new SyncStateAdapter(storage);
  await registry.setEntity({ id: TASK_PATH, notePath: TASK_PATH });
  await registry.setMirrorItem(PROJECT, 'conformance', TASK_PATH, {
    entityId: TASK_PATH,
  });
  const action = new AssembleProjectPassAction(
    vaultPort,
    registry,
    mirrorAdapters,
  );

  return { vault, mirror, registry, action, snapshot };
}

describe('AssembleProjectPassAction — a project pass end to end (F02 NWM-1, NWM-3)', () => {
  it('reconciles every field of the entity across the origin and the mirror', async () => {
    const { vault, mirror, action } = await setup();

    const records = await action.invoke(PROJECT);
    const mergedValue = (field: string) =>
      records.find((record) => record.field === field)!.result.value;

    expect(mergedValue('title')).toBe('fix the bug');
    expect(mergedValue('body')).toBe('Mirror body');
    expect(mergedValue('subtasks')).toBeNull();
    expect(mergedValue('completion')).toBe('false');
    expect(mergedValue('Status')).toBe('Done');
    expect(mergedValue('label')).toBe('alpha,beta');

    expect(mirror.currentTask(TASK_PATH)?.status).toBe('Done');
    expect(vault.content(TASK_PATH)).toContain('Mirror body');
  });

  it('persists the advanced baselines and round-trips them', async () => {
    const { registry, action, snapshot } = await setup();

    await action.invoke(PROJECT);

    const originStatus = await registry.readBaseline(
      TASK_PATH,
      'Status',
      'origin',
    );
    const mirrorStatus = await registry.readBaseline(
      TASK_PATH,
      'Status',
      'mirror:conformance',
    );
    expect(originStatus?.value).toBe('Done');
    expect(mirrorStatus?.value).toBe('Done');

    expect(snapshot()['coreBaselines']).toBeDefined();
  });

  it('writes nothing on a second pass when nothing changed (NWM-24)', async () => {
    const { mirror, action } = await setup();
    await action.invoke(PROJECT);

    const second = await action.invoke(PROJECT);

    expect(second.every((record) => record.written.length === 0)).toBe(true);
    expect(second.every((record) => record.advanced.length === 0)).toBe(true);
    expect(mirror.currentTask(TASK_PATH)?.status).toBe('Done');
  });
});
