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
import { AssembleProjectLifecyclePassAction } from '../../../../src/core/application/actions/AssembleProjectLifecyclePassAction.js';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';
import { connectionsOf } from '../../../../src/infrastructure/vault/connectionsOf.js';
import { vaultAdapter } from '../../../helpers/vaultAdapter.js';

const PROJECT = 'Acme';
const ACTIVE_HOME = 'Projecten/Acme/_Acme.md';
const ARCHIVED_HOME = 'Archief/Acme/_Acme.md';
const TASK_PATH = 'Projecten/Acme/taken/fix-the-bug.md';
const MTIME = Date.parse('2026-10-08T10:00:00Z');

const HOME = [
  '---',
  'type: project',
  'connections:',
  '  a:',
  '    tool: conformance',
  '    project: board-a',
  '  b:',
  '    tool: conformance',
  '    project: board-b',
  '---',
].join('\n');

const ONBOARD_HOME = [
  '---',
  'type: project',
  'connections:',
  '  a:',
  '    tool: conformance',
  '    project: board-new',
  '---',
].join('\n');

class FakeAppVault {
  private readonly notes = new Map<
    string,
    { content: string; mtime: number }
  >();

  readonly metadataCache = {
    getFileCache: (file: { path: string }) => ({
      frontmatter: {
        connections: connectionsOf(this.notes.get(file.path)?.content ?? ''),
      },
    }),
  };

  seed(path: string, content: string, mtime: number): void {
    this.notes.set(path, { content, mtime });
  }

  has(path: string): boolean {
    return this.notes.has(path);
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

  getFiles(): TFileInstance[] {
    return this.getMarkdownFiles();
  }

  getFolderByPath(): object | null {
    return {};
  }

  async createFolder(): Promise<void> {}

  async read(file: TFileInstance): Promise<string> {
    return this.notes.get(file.path)!.content;
  }

  async create(path: string, content: string): Promise<void> {
    this.notes.set(path, { content, mtime: Date.now() });
  }

  async modify(file: TFileInstance, content: string): Promise<void> {
    this.notes.set(file.path, { content, mtime: Date.now() });
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
  constructor(private readonly vault: FakeAppVault) {}

  async renameFile(file: TFileInstance, newPath: string): Promise<void> {
    this.vault.rename(file.path, newPath);
  }

  async trashFile(file: TFileInstance): Promise<void> {
    this.vault.rename(file.path, `${file.path}.trashed`);
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

interface SetupOptions {
  vaultArchived: boolean;
  mirrorA: boolean;
  mirrorB: boolean;
  homePath?: string;
}

async function setup(options: SetupOptions) {
  const appVault = new FakeAppVault();
  const homePath =
    options.homePath ?? (options.vaultArchived ? ARCHIVED_HOME : ACTIVE_HOME);
  appVault.seed(homePath, HOME, MTIME);
  const registry = new SyncStateAdapter(memoryStorage());
  await registry.setEntity({ id: 'e1', notePath: TASK_PATH });

  const app = {
    vault: appVault,
    fileManager: new FakeFileManager(appVault),
    metadataCache: appVault.metadataCache,
  } as unknown as App;
  const vault = vaultAdapter(app, {
    registeredApplications: new Set(['conformance']),
  });

  const mirror = new ConformanceMirrorAdapter();
  mirror.seedProject('board-a', options.mirrorA);
  mirror.seedProject('board-b', options.mirrorB);
  const mirrorAdapters: MirrorAdapterFactoryPort = { create: () => mirror };

  const action = new AssembleProjectLifecyclePassAction(
    vault,
    registry,
    mirrorAdapters,
  );

  return { vault: appVault, registry, mirror, action };
}

async function seedBaseline(
  registry: SyncStateAdapter,
  side: string,
  archived: boolean,
): Promise<void> {
  await registry.writeBaseline(
    PROJECT,
    'lifecycle',
    side,
    new Baseline(archived ? 'true' : 'false', false),
  );
}

async function seedBaselines(
  registry: SyncStateAdapter,
  archived: boolean,
): Promise<void> {
  for (const side of ['origin', 'mirror:a', 'mirror:b']) {
    await seedBaseline(registry, side, archived);
  }
}

describe('AssembleProjectLifecyclePassAction — N-way lifecycle (F02 NWM-15)', () => {
  it('freezes the vault and the other mirrors when a mirror starts the archive', async () => {
    const { vault, registry, mirror, action } = await setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaselines(registry, false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(vault.has(ACTIVE_HOME)).toBe(false);
    expect((await registry.getEntity('e1'))?.notePath).toBe(
      'Archief/Acme/taken/fix-the-bug.md',
    );
    expect(mirror.currentProject('board-a')?.archived).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('freezes the mirrors when the vault starts the archive', async () => {
    const { vault, mirror, registry, action } = await setup({
      vaultArchived: true,
      mirrorA: false,
      mirrorB: false,
    });
    await seedBaselines(registry, false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(mirror.currentProject('board-a')?.archived).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('unfreezes the vault and the mirrors when a mirror starts the unfreeze', async () => {
    const { vault, mirror, registry, action } = await setup({
      vaultArchived: true,
      mirrorA: false,
      mirrorB: true,
    });
    await seedBaselines(registry, true);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(false);
    expect(vault.has(ACTIVE_HOME)).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(false);
    expect(mirror.currentProject('board-a')?.archived).toBe(false);
    expect(mirror.currentProject('board-b')?.archived).toBe(false);
  });

  it('advances every side baseline after the freeze settles (NWM-17)', async () => {
    const { registry, action } = await setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaselines(registry, false);

    await action.invoke(PROJECT);

    for (const side of ['origin', 'mirror:a', 'mirror:b']) {
      const baseline = await registry.readBaseline(PROJECT, 'lifecycle', side);
      expect(baseline?.value).toBe('true');
    }
  });

  it('writes nothing on a second pass once the freeze has settled (NWM-24)', async () => {
    const { vault, mirror, registry, action } = await setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaselines(registry, false);
    await action.invoke(PROJECT);

    const second = await action.invoke(PROJECT);

    expect(second.written).toEqual([]);
    expect(second.advanced).toEqual([]);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('does not freeze a project whose active home note has a legacy name', async () => {
    const { vault, mirror, registry, action } = await setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
      homePath: 'Projecten/Acme/home.md',
    });
    await seedBaselines(registry, false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(false);
    expect(vault.has('Projecten/Acme/home.md')).toBe(true);
    expect(vault.has('Archief/Acme/home.md')).toBe(false);
    expect(mirror.currentProject('board-a')?.archived).toBe(false);
  });

  it('lets a mirror with a decisive timestamp win the archived fact (NWM-6)', async () => {
    const { vault, mirror, registry, action } = await setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaseline(registry, 'origin', false);
    await seedBaseline(registry, 'mirror:a', false);
    await seedBaseline(registry, 'mirror:b', true);
    mirror.setProjectTime('board-a', '2026-10-08T11:00:00Z');
    mirror.setProjectTime('board-b', '2026-10-08T09:00:00Z');

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('onboards a mirror whose project read returns null, then skips observing it', async () => {
    const { mirror, registry, action } = await setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    mirror.seedMissingProject('board-b');
    await seedBaselines(registry, false);

    const record = await action.invoke(PROJECT);

    expect(mirror.createCalls).toEqual(['board-b']);
    expect(await registry.resolveMirrorProject(PROJECT, 'b')).toBe('board-b');
    expect(record.frozen).toBe(true);
    expect(record.advanced).not.toContain('mirror:b');
    expect(mirror.currentProject('board-b')?.archived).toBe(false);
    const baseline = await registry.readBaseline(
      PROJECT,
      'lifecycle',
      'mirror:b',
    );
    expect(baseline?.value).toBe('false');
  });

  it('skips a connection whose project read throws and still reconciles the rest', async () => {
    const { vault, mirror, registry, action } = await setup({
      vaultArchived: true,
      mirrorA: true,
      mirrorB: false,
    });
    mirror.seedThrowingProject('board-a');
    await seedBaselines(registry, false);

    const record = await action.invoke(PROJECT);

    expect(mirror.createCalls).not.toContain('board-a');
    expect(record.frozen).toBe(true);
    expect(record.advanced).toContain('mirror:b');
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('resolves two disagreeing mirrors to the vault tie-break without a decisive timestamp (NWM-12)', async () => {
    const { vault, mirror, registry, action } = await setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaseline(registry, 'origin', false);
    await seedBaseline(registry, 'mirror:a', false);
    await seedBaseline(registry, 'mirror:b', true);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(false);
    expect(vault.has(ACTIVE_HOME)).toBe(true);
    expect(mirror.currentProject('board-a')?.archived).toBe(false);
    expect(mirror.currentProject('board-b')?.archived).toBe(false);
  });

  it('onboards a connection with no mirror project and syncs it in the same pass', async () => {
    const appVault = new FakeAppVault();
    appVault.seed(ARCHIVED_HOME, ONBOARD_HOME, MTIME);
    const registry = new SyncStateAdapter(memoryStorage());
    const app = {
      vault: appVault,
      fileManager: new FakeFileManager(appVault),
      metadataCache: appVault.metadataCache,
    } as unknown as App;
    const vault = vaultAdapter(app, {
      registeredApplications: new Set(['conformance']),
    });
    const mirror = new ConformanceMirrorAdapter();
    mirror.seedAbsentProject('board-new');
    const mirrorAdapters: MirrorAdapterFactoryPort = {
      create: () => mirror,
    };
    const action = new AssembleProjectLifecyclePassAction(
      vault,
      registry,
      mirrorAdapters,
    );

    const record = await action.invoke(PROJECT);

    expect(mirror.createCalls).toEqual(['board-new']);
    expect(await registry.resolveMirrorProject(PROJECT, 'a')).toBe('board-new');
    expect(record.frozen).toBe(true);
    expect(mirror.currentProject('board-new')?.archived).toBe(true);
  });

  it('resolves a recorded mirror project without creating it again', async () => {
    const { mirror, registry, action } = await setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
    });
    await registry.recordMirrorProject(PROJECT, 'a', 'conformance', 'board-a');
    await registry.recordMirrorProject(PROJECT, 'b', 'conformance', 'board-b');
    await seedBaselines(registry, false);

    await action.invoke(PROJECT);

    expect(mirror.createCalls).toEqual([]);
  });

  it('renames a mirror project whose name drifted from the vault project (NWM-31)', async () => {
    const { mirror, registry, action } = await setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
    });
    mirror.seedProjectName('board-a', 'Old Name');
    await seedBaselines(registry, false);

    await action.invoke(PROJECT);

    expect(mirror.currentProject('board-a')?.name).toBe(PROJECT);
  });

  it('renames a mirror project whose name drifts after adoption (NWM-31)', async () => {
    const { mirror, registry, action } = await setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
    });
    mirror.seedProjectName('board-a', PROJECT);
    await seedBaselines(registry, false);
    await action.invoke(PROJECT);

    mirror.seedProjectName('board-a', 'Drifted Name');
    await action.invoke(PROJECT);

    expect(mirror.currentProject('board-a')?.name).toBe(PROJECT);
  });

  it('leaves a mirror project whose name already matches the vault project (NWM-31)', async () => {
    const { mirror, registry, action } = await setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
    });
    mirror.seedProjectName('board-a', PROJECT);
    await seedBaselines(registry, false);

    await action.invoke(PROJECT);

    expect(mirror.currentProject('board-a')?.name).toBe(PROJECT);
  });
});
