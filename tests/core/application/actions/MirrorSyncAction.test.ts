import { projectFromNotePath } from '../../../../src/core/domain/paths.js';
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
import { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import type { CanonicalField } from '../../../../src/core/domain/canonicalField.js';
import type { CanonicalFieldWrite } from '../../../../src/core/port/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { vaultAdapter } from '../../../helpers/vaultAdapter.js';

const PROJECT = 'Acme';
const HOME_PATH = 'Projecten/Acme/_Acme.md';
const TASK_PATH = 'Projecten/Acme/taken/fix-the-bug.md';
const MTIME = Date.parse('2026-10-08T10:00:00Z');

const HOME = [
  '---',
  'type: project',
  'connections:',
  '  vault:',
  '    tool: vault',
  '    id: Acme',
  '  conformance:',
  '    tool: conformance',
  '    project: board-1',
  '---',
].join('\n');

const TASK = [
  '---',
  'categories: [taken]',
  'status: Done',
  'labels: [type:task, alpha, beta]',
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

  const vaultPort = vaultAdapter(app, {
    registeredApplications: new Set(['conformance']),
  });

  const mirror = new ConformanceMirrorAdapter();
  mirror.seed(mirrorTask('Building', 'Mirror body'));
  mirror.setFieldTime(TASK_PATH, 'body', '2026-10-08T11:00:00Z');
  const mirrorAdapters: MirrorAdapterFactoryPort = {
    create: (application): MirrorPort | null =>
      application === 'conformance' ? mirror : null,
  };

  const { storage, snapshot } = fakeStorage();
  const registry = new SyncStateAdapter(storage);
  await registry.setEntity({
    id: TASK_PATH,
    notePath: TASK_PATH,
    projectId: projectFromNotePath(TASK_PATH),
  });
  await registry.setMirrorItem(PROJECT, 'conformance', TASK_PATH, {
    entityId: TASK_PATH,
  });
  const action = new MirrorSyncAction(vaultPort, registry, mirrorAdapters);

  return { vault, mirror, registry, action, snapshot };
}

describe('MirrorSyncAction — a project pass end to end (F02 NWM-1, NWM-3)', () => {
  it('reconciles every field of the entity across the origin and the mirror', async () => {
    const { vault, mirror, action } = await setup();

    const records = await action.invoke(PROJECT);
    const mergedValue = (field: string) =>
      records.find((record) => record.field === field)!.result.value;

    expect(mergedValue('title')).toBe('fix-the-bug');
    expect(mergedValue('body')).toBe('Mirror body');
    expect(mergedValue('subtasks')).toBeNull();
    expect(mergedValue('completion')).toBe('false');
    expect(mergedValue('Status')).toBe('Done');
    expect(mergedValue('label')).toBe('["type:task","alpha","beta"]');

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

const ENTITY = 'Projecten/Acme/taken/fix-the-bug.md';

const MERGED_FIELDS: readonly CanonicalField[] = [
  'title',
  'body',
  'subtasks',
  'completion',
  'Status',
  'label',
];

const ORIGIN_FIELDS: Readonly<Record<CanonicalField, string | null>> = {
  title: 'Task',
  body: '',
  subtasks: null,
  completion: 'false',
  Status: 'Building',
  label: '[]',
};

class FieldVault extends FakeVaultBase {
  connections: ConnectionDataTransferObject[] = [];
  entities: readonly string[] = [ENTITY];
  readonly values = new Map<string, string | null>();
  readonly applied: CanonicalFieldWrite[] = [];

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return this.connections;
  }

  override async listEntities(): Promise<readonly string[]> {
    return this.entities;
  }

  override async observe(
    _handle: string,
    field: string,
  ): Promise<OriginObservation> {
    return new OriginObservation({
      current: this.values.get(field) ?? null,
      currentCompleted: false,
      fieldTime: null,
      trustworthy: true,
    });
  }

  override async readTask(): Promise<CanonicalTask | null> {
    return null;
  }

  override async applyField(write: CanonicalFieldWrite): Promise<void> {
    this.applied.push(write);
  }

  override async trashNote(): Promise<void> {}
}

function connection(
  slug: string,
  target: string,
): ConnectionDataTransferObject {
  return new ConnectionDataTransferObject({
    slug,
    application: 'conformance',
    target,
  });
}

function seededTask(status: string): CanonicalTask {
  return new CanonicalTask({
    handle: ENTITY,
    entityId: ENTITY,
    title: 'Task',
    body: '',
    status,
    completed: false,
    parent: null,
    labels: [],
  });
}

async function seedBaselines(
  registry: SyncStateAdapter,
  sides: readonly string[],
  status: string,
): Promise<void> {
  for (const side of sides) {
    for (const field of MERGED_FIELDS) {
      const value = field === 'Status' ? status : ORIGIN_FIELDS[field];
      if (value === null) {
        continue;
      }
      await registry.writeBaseline(
        ENTITY,
        field,
        side,
        new Baseline(value, false),
      );
    }
  }
}

describe('MirrorSyncAction — the Status field at N=3 (F02 NWM-1, NWM-6)', () => {
  it('writes the provably-newest mirror delta to every capable mirror', async () => {
    const alpha = new ConformanceMirrorAdapter();
    const beta = new ConformanceMirrorAdapter();
    const gamma = new ConformanceMirrorAdapter();
    alpha.seed(seededTask('Review'));
    beta.seed(seededTask('Todo'));
    gamma.seed(seededTask('Building'));
    alpha.setFieldTime(ENTITY, 'Status', '2026-10-08T11:00:00Z');
    beta.setFieldTime(ENTITY, 'Status', '2026-10-08T10:00:00Z');

    const vault = new FieldVault();
    vault.connections = [
      connection('alpha', 'board-a'),
      connection('beta', 'board-b'),
      connection('gamma', 'board-c'),
    ];
    for (const [field, value] of Object.entries(ORIGIN_FIELDS)) {
      vault.values.set(field, value);
    }
    const registry = new SyncStateAdapter(fakeStorage().storage);
    await registry.setEntity({
      id: ENTITY,
      notePath: ENTITY,
      projectId: projectFromNotePath(ENTITY),
    });
    for (const slug of ['alpha', 'beta', 'gamma']) {
      await registry.setMirrorItem(PROJECT, slug, ENTITY, { entityId: ENTITY });
    }
    await seedBaselines(
      registry,
      ['mirror:alpha', 'mirror:beta', 'mirror:gamma', 'origin'],
      'Building',
    );
    const adapters: Readonly<Record<string, MirrorPort>> = {
      'board-a': alpha,
      'board-b': beta,
      'board-c': gamma,
    };
    const action = new MirrorSyncAction(vault, registry, {
      create: (_application, target) => adapters[target] ?? null,
    });

    const records = await action.invoke(PROJECT);
    const status = records.find((record) => record.field === 'Status')!;

    expect(status.result.rung).toBe(1);
    expect(status.result.winner).toBe('mirror:alpha');
    expect(alpha.currentTask(ENTITY)?.status).toBe('Review');
    expect(beta.currentTask(ENTITY)?.status).toBe('Review');
    expect(gamma.currentTask(ENTITY)?.status).toBe('Review');
  });
});

class FailingMirrorAdapter extends ConformanceMirrorAdapter {
  override async applyField(): Promise<void> {
    throw new Error('mirror write failed');
  }
}

describe('MirrorSyncAction — a failed mirror write (F02)', () => {
  it('records the failed side and keeps fanning out to the rest', async () => {
    const boom = new FailingMirrorAdapter();
    const alpha = new ConformanceMirrorAdapter();
    boom.seed(seededTask('Building'));
    alpha.seed(seededTask('Building'));

    const vault = new FieldVault();
    vault.connections = [
      connection('boom', 'board-boom'),
      connection('alpha', 'board-alpha'),
    ];
    for (const [field, value] of Object.entries(ORIGIN_FIELDS)) {
      vault.values.set(field, field === 'Status' ? 'Done' : value);
    }
    const registry = new SyncStateAdapter(fakeStorage().storage);
    await registry.setEntity({
      id: ENTITY,
      notePath: ENTITY,
      projectId: projectFromNotePath(ENTITY),
    });
    for (const slug of ['boom', 'alpha']) {
      await registry.setMirrorItem(PROJECT, slug, ENTITY, { entityId: ENTITY });
    }
    await seedBaselines(
      registry,
      ['mirror:boom', 'mirror:alpha', 'origin'],
      'Building',
    );
    const adapters: Readonly<Record<string, MirrorPort>> = {
      'board-boom': boom,
      'board-alpha': alpha,
    };
    const action = new MirrorSyncAction(vault, registry, {
      create: (_application, target) => adapters[target] ?? null,
    });

    const records = await action.invoke(PROJECT);
    const status = records.find((record) => record.field === 'Status')!;

    expect(status.failed).toEqual(['mirror:boom']);
    expect(status.written).toEqual(['mirror:alpha']);
    expect(status.advanced).toEqual(['mirror:alpha', 'origin']);
    expect(alpha.currentTask(ENTITY)?.status).toBe('Done');
  });
});
