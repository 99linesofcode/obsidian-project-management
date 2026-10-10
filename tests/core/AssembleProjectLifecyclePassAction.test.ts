import { describe, expect, it } from 'vitest';
import { AssembleProjectLifecyclePassAction } from '../../src/core/AssembleProjectLifecyclePassAction.js';
import { AdapterRegistration } from '../../src/core/data/AdapterRegistration.js';
import { Baseline } from '../../src/core/data/Baseline.js';
import { ConnectionEnvelope } from '../../src/core/data/ConnectionEnvelope.js';
import { DeclaredConnection } from '../../src/core/data/DeclaredConnection.js';
import type { RegisteredAdapter } from '../../src/core/data/RegisteredAdapter.js';
import type { MirrorAdapterFactoryPort } from '../../src/core/ports/MirrorAdapterFactoryPort.js';
import type { MirrorProjectPort } from '../../src/core/ports/MirrorProjectPort.js';
import type { ProjectSourcePort } from '../../src/core/ports/ProjectSourcePort.js';
import { registerAdapters } from '../../src/core/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../src/infrastructure/fake/conformanceDescriptor.js';
import { CoreBaselineStoreAdapter } from '../../src/infrastructure/registry/CoreBaselineStoreAdapter.js';
import { VaultProjectLifecycleAdapter } from '../../src/infrastructure/vault/VaultProjectLifecycleAdapter.js';

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

class FakeVault {
  private readonly notes = new Map<
    string,
    { content: string; mtime: number }
  >();

  seed(path: string, content: string, mtime: number): void {
    this.notes.set(path, { content, mtime });
  }

  async findHomeNotePath(project: string): Promise<string | null> {
    for (const path of this.notes.keys()) {
      const segments = path.split('/');
      if (
        (segments[0] === 'Projecten' || segments[0] === 'Archief') &&
        segments[1] === project &&
        segments.length === 3
      ) {
        return path;
      }
    }
    return null;
  }

  async modifiedTime(path: string): Promise<string | null> {
    const note = this.notes.get(path);
    return note === undefined ? null : new Date(note.mtime).toISOString();
  }

  async moveFolder(fromPrefix: string, toPrefix: string): Promise<void> {
    const from = `${fromPrefix}/`;
    const to = `${toPrefix}/`;
    for (const [path, note] of [...this.notes.entries()]) {
      if (path.startsWith(from)) {
        this.notes.delete(path);
        this.notes.set(`${to}${path.slice(from.length)}`, note);
      }
    }
  }

  has(path: string): boolean {
    return this.notes.has(path);
  }
}

class FakeRegistry {
  records: Array<{ id: string; notePath: string }> = [];

  async listEntities(): Promise<Array<{ id: string; notePath: string }>> {
    return this.records;
  }

  async setEntity(record: { id: string; notePath: string }): Promise<void> {
    this.records = this.records.map((candidate) =>
      candidate.id === record.id ? record : candidate,
    );
  }
}

class FakeProjectSource implements ProjectSourcePort {
  connections: DeclaredConnection[] = [];

  async readConnections(): Promise<readonly DeclaredConnection[]> {
    return this.connections;
  }

  async listEntities(): Promise<readonly string[]> {
    return [];
  }
}

function memoryStorage() {
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
  };
}

function connection(slug: string, target: string): DeclaredConnection {
  return new DeclaredConnection({
    slug,
    envelope: new ConnectionEnvelope({ application: 'conformance', target }),
  });
}

class FakeMirrorProjects implements MirrorProjectPort {
  readonly recorded = new Map<string, string>();

  async resolve(project: string, connection: string): Promise<string | null> {
    return this.recorded.get(`${project}\u0000${connection}`) ?? null;
  }

  async record(
    project: string,
    connection: string,
    _application: string,
    handle: string,
  ): Promise<void> {
    this.recorded.set(`${project}\u0000${connection}`, handle);
  }
}

interface SetupOptions {
  vaultArchived: boolean;
  mirrorA: boolean;
  mirrorB: boolean;
  homePath?: string;
}

function setup(options: SetupOptions) {
  const vault = new FakeVault();
  const homePath =
    options.homePath ??
    (options.vaultArchived ? ARCHIVED_HOME : ACTIVE_HOME);
  vault.seed(homePath, HOME, MTIME);
  const registry = new FakeRegistry();
  registry.records = [{ id: 'e1', notePath: TASK_PATH }];

  const projectSource = new FakeProjectSource();
  projectSource.connections = [
    connection('a', 'board-a'),
    connection('b', 'board-b'),
  ];

  const mirror = new ConformanceMirrorAdapter();
  mirror.seedProject('board-a', options.mirrorA);
  mirror.seedProject('board-b', options.mirrorB);
  const registered: RegisteredAdapter = registerAdapters([
    new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
  ]).adapters.get('conformance')!;
  const mirrorAdapters: MirrorAdapterFactoryPort = { create: () => registered };

  const { storage } = memoryStorage();
  const baselines = new CoreBaselineStoreAdapter(storage);
  const origin = new VaultProjectLifecycleAdapter(vault, registry);
  const mirrorProjects = new FakeMirrorProjects();
  const action = new AssembleProjectLifecyclePassAction(
    projectSource,
    origin,
    baselines,
    mirrorAdapters,
    mirrorProjects,
  );

  return { vault, registry, mirror, baselines, mirrorProjects, action };
}

async function seedBaseline(
  baselines: CoreBaselineStoreAdapter,
  side: string,
  archived: boolean,
): Promise<void> {
  await baselines.write(
    PROJECT,
    'lifecycle',
    side,
    new Baseline(archived ? 'true' : 'false', false),
  );
}

async function seedBaselines(
  baselines: CoreBaselineStoreAdapter,
  archived: boolean,
): Promise<void> {
  for (const side of ['origin', 'mirror:a', 'mirror:b']) {
    await seedBaseline(baselines, side, archived);
  }
}

describe('AssembleProjectLifecyclePassAction — N-way lifecycle (F02 NWM-15)', () => {
  it('freezes the vault and the other mirrors when a mirror starts the archive', async () => {
    const { vault, registry, mirror, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaselines(baselines, false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(vault.has(ACTIVE_HOME)).toBe(false);
    expect(registry.records[0]?.notePath).toBe(
      'Archief/Acme/taken/fix-the-bug.md',
    );
    expect(mirror.currentProject('board-a')?.archived).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('freezes the mirrors when the vault starts the archive', async () => {
    const { vault, mirror, baselines, action } = setup({
      vaultArchived: true,
      mirrorA: false,
      mirrorB: false,
    });
    await seedBaselines(baselines, false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(mirror.currentProject('board-a')?.archived).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('unfreezes the vault and the mirrors when a mirror starts the unfreeze', async () => {
    const { vault, mirror, baselines, action } = setup({
      vaultArchived: true,
      mirrorA: false,
      mirrorB: true,
    });
    await seedBaselines(baselines, true);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(false);
    expect(vault.has(ACTIVE_HOME)).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(false);
    expect(mirror.currentProject('board-a')?.archived).toBe(false);
    expect(mirror.currentProject('board-b')?.archived).toBe(false);
  });

  it('advances every side baseline after the freeze settles (NWM-17)', async () => {
    const { baselines, action } = setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaselines(baselines, false);

    await action.invoke(PROJECT);

    for (const side of ['origin', 'mirror:a', 'mirror:b']) {
      const baseline = await baselines.read(PROJECT, 'lifecycle', side);
      expect(baseline?.value).toBe('true');
    }
  });

  it('writes nothing on a second pass once the freeze has settled (NWM-24)', async () => {
    const { vault, mirror, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaselines(baselines, false);
    await action.invoke(PROJECT);

    const second = await action.invoke(PROJECT);

    expect(second.written).toEqual([]);
    expect(second.advanced).toEqual([]);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('does not freeze a project whose active home note has a legacy name', async () => {
    const { vault, mirror, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
      homePath: 'Projecten/Acme/home.md',
    });
    await seedBaselines(baselines, false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(false);
    expect(vault.has('Projecten/Acme/home.md')).toBe(true);
    expect(vault.has('Archief/Acme/home.md')).toBe(false);
    expect(mirror.currentProject('board-a')?.archived).toBe(false);
  });

  it('lets a mirror with a decisive timestamp win the archived fact (NWM-6)', async () => {
    const { vault, mirror, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaseline(baselines, 'origin', false);
    await seedBaseline(baselines, 'mirror:a', false);
    await seedBaseline(baselines, 'mirror:b', true);
    mirror.setProjectTime('board-a', '2026-10-08T11:00:00Z');
    mirror.setProjectTime('board-b', '2026-10-08T09:00:00Z');

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('onboards a mirror whose project read returns null, then skips observing it', async () => {
    const { mirror, mirrorProjects, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    mirror.seedMissingProject('board-b');
    await seedBaselines(baselines, false);

    const record = await action.invoke(PROJECT);

    expect(mirror.createCalls).toEqual(['board-b']);
    expect(await mirrorProjects.resolve(PROJECT, 'b')).toBe('board-b');
    expect(record.frozen).toBe(true);
    expect(record.advanced).not.toContain('mirror:b');
    expect(mirror.currentProject('board-b')?.archived).toBe(false);
    const baseline = await baselines.read(PROJECT, 'lifecycle', 'mirror:b');
    expect(baseline?.value).toBe('false');
  });

  it('skips a connection whose project read throws and still reconciles the rest', async () => {
    const { vault, mirror, baselines, action } = setup({
      vaultArchived: true,
      mirrorA: true,
      mirrorB: false,
    });
    mirror.seedThrowingProject('board-a');
    await seedBaselines(baselines, false);

    const record = await action.invoke(PROJECT);

    expect(mirror.createCalls).not.toContain('board-a');
    expect(record.frozen).toBe(true);
    expect(record.advanced).toContain('mirror:b');
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(mirror.currentProject('board-b')?.archived).toBe(true);
  });

  it('resolves two disagreeing mirrors to the vault tie-break without a decisive timestamp (NWM-12)', async () => {
    const { vault, mirror, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: true,
      mirrorB: false,
    });
    await seedBaseline(baselines, 'origin', false);
    await seedBaseline(baselines, 'mirror:a', false);
    await seedBaseline(baselines, 'mirror:b', true);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(false);
    expect(vault.has(ACTIVE_HOME)).toBe(true);
    expect(mirror.currentProject('board-a')?.archived).toBe(false);
    expect(mirror.currentProject('board-b')?.archived).toBe(false);
  });

  it('onboards a connection with no mirror project and syncs it in the same pass', async () => {
    const vault = new FakeVault();
    vault.seed(ARCHIVED_HOME, HOME, MTIME);
    const registry = new FakeRegistry();
    const projectSource = new FakeProjectSource();
    projectSource.connections = [connection('a', 'board-new')];
    const mirror = new ConformanceMirrorAdapter();
    mirror.seedAbsentProject('board-new');
    const registered: RegisteredAdapter = registerAdapters([
      new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
    ]).adapters.get('conformance')!;
    const mirrorAdapters: MirrorAdapterFactoryPort = {
      create: () => registered,
    };
    const { storage } = memoryStorage();
    const mirrorProjects = new FakeMirrorProjects();
    const action = new AssembleProjectLifecyclePassAction(
      projectSource,
      new VaultProjectLifecycleAdapter(vault, registry),
      new CoreBaselineStoreAdapter(storage),
      mirrorAdapters,
      mirrorProjects,
    );

    const record = await action.invoke(PROJECT);

    expect(mirror.createCalls).toEqual(['board-new']);
    expect(await mirrorProjects.resolve(PROJECT, 'a')).toBe('board-new');
    expect(record.frozen).toBe(true);
    expect(mirror.currentProject('board-new')?.archived).toBe(true);
  });

  it('resolves a recorded mirror project without creating it again', async () => {
    const { mirror, mirrorProjects, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
    });
    mirrorProjects.recorded.set(`${PROJECT}\u0000a`, 'board-a');
    mirrorProjects.recorded.set(`${PROJECT}\u0000b`, 'board-b');
    await seedBaselines(baselines, false);

    await action.invoke(PROJECT);

    expect(mirror.createCalls).toEqual([]);
  });

  it('renames a mirror project whose name drifted from the vault project (NWM-31)', async () => {
    const { mirror, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
    });
    mirror.seedProjectName('board-a', 'Old Name');
    await seedBaselines(baselines, false);

    await action.invoke(PROJECT);

    expect(mirror.currentProject('board-a')?.name).toBe(PROJECT);
  });

  it('renames a mirror project whose name drifts after adoption (NWM-31)', async () => {
    const { mirror, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
    });
    mirror.seedProjectName('board-a', PROJECT);
    await seedBaselines(baselines, false);
    await action.invoke(PROJECT);

    mirror.seedProjectName('board-a', 'Drifted Name');
    await action.invoke(PROJECT);

    expect(mirror.currentProject('board-a')?.name).toBe(PROJECT);
  });

  it('leaves a mirror project whose name already matches the vault project (NWM-31)', async () => {
    const { mirror, baselines, action } = setup({
      vaultArchived: false,
      mirrorA: false,
      mirrorB: false,
    });
    mirror.seedProjectName('board-a', PROJECT);
    await seedBaselines(baselines, false);

    await action.invoke(PROJECT);

    expect(mirror.currentProject('board-a')?.name).toBe(PROJECT);
  });
});
