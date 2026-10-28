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
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import { CanonicalTask } from '../../../../src/core/port/data/CanonicalTask.js';
import { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';
import type { VaultAdapter } from '../../../../src/infrastructure/vault/VaultAdapter.js';
import { vaultAdapter } from '../../../helpers/vaultAdapter.js';

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
  'status: Building',
  'affiliation: ["[[_Acme]]"]',
  'labels: [type:task]',
  '---',
  '',
].join('\n');

class FakeVault {
  private readonly notes = new Map<string, { content: string; mtime: number }>();
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
    return note === undefined
      ? null
      : new TFile(path, 'md', { mtime: note.mtime });
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

function setup(): { vault: FakeVault; adapter: VaultAdapter } {
  const vault = new FakeVault();
  vault.seed(HOME_PATH, HOME, MTIME);
  vault.seed(NOTE_PATH, NOTE, MTIME);
  vault.frontmatter.set(HOME_PATH, {
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

function mirrorTask(labels: readonly string[]): CanonicalTask {
  return new CanonicalTask({
    handle: NOTE_PATH,
    entityId: NOTE_PATH,
    title: 'fix the bug',
    body: '',
    status: 'Building',
    completed: false,
    parent: null,
    labels,
  });
}

async function seedRegistry(
  registry: SyncStateAdapter,
  labels: readonly string[],
): Promise<void> {
  await registry.setEntity({ id: NOTE_PATH, notePath: NOTE_PATH });
  await registry.setMirrorItem('Acme', 'conformance', NOTE_PATH, {
    entityId: NOTE_PATH,
  });
  void labels;
}

describe('LBL-3 — labels reconcile as one canonical field', () => {
  it("writes the mirror's full ordered label set to the vault, duplicates kept", async () => {
    const { adapter } = setup();
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(mirrorTask(['type:task', 'priority:high', 'priority:high']));
    const registry = new SyncStateAdapter(memoryStorage());
    await seedRegistry(registry, []);
    const originLabel = await adapter.observe(NOTE_PATH, 'label');
    await registry.writeBaseline(
      NOTE_PATH,
      'label',
      'origin',
      new Baseline(originLabel.current!, false),
    );
    const action = new MirrorSyncAction(adapter, registry, {
      create: () => mirror,
    });

    const records = await action.invoke('Acme');
    const label = records.find((record) => record.field === 'label')!;

    expect(label.result.winner).toBe('mirror:conformance');
    expect(label.result.rung).toBe(0);
    expect((await adapter.readTask(NOTE_PATH))?.labels).toEqual([
      'type:task',
      'priority:high',
      'priority:high',
    ]);
  });

  it('settles an agreeing pair with zero writes', async () => {
    const { adapter } = setup();
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(mirrorTask(['type:task']));
    const registry = new SyncStateAdapter(memoryStorage());
    await seedRegistry(registry, ['type:task']);
    const action = new MirrorSyncAction(adapter, registry, {
      create: () => mirror,
    });

    await action.invoke('Acme');
    const second = await action.invoke('Acme');
    const label = second.find((record) => record.field === 'label')!;

    expect((await adapter.readTask(NOTE_PATH))?.labels).toEqual(['type:task']);
    expect(label.written).toEqual([]);
    expect(label.advanced).toEqual([]);
  });
});
