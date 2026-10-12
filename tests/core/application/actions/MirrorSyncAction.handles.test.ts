import { describe, expect, it } from 'vitest';
import { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import { CanonicalTask } from '../../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';

const ENTITY = 'Projecten/Acme/taken/fix-the-bug.md';

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

class FakeVault extends FakeVaultBase {
  connections: ConnectionDataTransferObject[] = [];
  entities: readonly string[] = [ENTITY];
  readonly values = new Map<string, string | null>();

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

  override async applyField(): Promise<void> {}
  override async trashNote(): Promise<void> {}
}

function mirrorLikeOrigin(
  status: string,
  vault: FakeVault = new FakeVault(),
): FakeVault {
  vault.values.set('title', 'Task');
  vault.values.set('body', '');
  vault.values.set('completion', 'false');
  vault.values.set('Status', status);
  vault.values.set('label', '[]');
  return vault;
}

class RecordingFactory implements MirrorAdapterFactoryPort {
  readonly calls: Array<{ application: string; target: string }> = [];

  constructor(private readonly adapters: ReadonlyMap<string, MirrorPort>) {}

  create(application: string, target: string): MirrorPort | null {
    this.calls.push({ application, target });
    return this.adapters.get(target) ?? null;
  }
}

function registeredMirror(): ConformanceMirrorAdapter {
  return new ConformanceMirrorAdapter();
}

function seededTask(handle: string, status: string): CanonicalTask {
  return new CanonicalTask({
    handle,
    entityId: ENTITY,
    title: 'Task',
    body: '',
    status,
    completed: false,
    parent: null,
    labels: [],
  });
}

function connection(
  slug: string,
  target: string,
): ConnectionDataTransferObject {
  return new ConnectionDataTransferObject({
    slug,
    application: 'github',
    target,
  });
}

describe('MirrorSyncAction — entity to per-connection handle (F02 NWM-2)', () => {
  it('resolves each connection its own handle and scopes the adapter by target', async () => {
    const first = registeredMirror();
    const second = registeredMirror();
    first.seed(seededTask('handle-a', 'Building'));
    second.seed(seededTask('handle-b', 'Building'));

    const vault = new FakeVault();
    vault.connections = [
      connection('gh-main', 'target-a'),
      connection('gh-second', 'target-b'),
    ];
    mirrorLikeOrigin('Done', vault);
    const factory = new RecordingFactory(
      new Map([
        ['target-a', first],
        ['target-b', second],
      ]),
    );
    const registry = new SyncStateAdapter(memoryStorage());
    await registry.setEntity({ id: ENTITY, notePath: ENTITY });
    await registry.setMirrorItem('Acme', 'gh-main', 'handle-a', {
      entityId: ENTITY,
    });
    await registry.setMirrorItem('Acme', 'gh-second', 'handle-b', {
      entityId: ENTITY,
    });
    const action = new MirrorSyncAction(vault, registry, factory);

    const records = await action.invoke('Acme');
    const status = records.find((record) => record.field === 'Status')!;

    expect(factory.calls).toEqual([
      { application: 'github', target: 'target-a' },
      { application: 'github', target: 'target-b' },
    ]);
    expect(first.currentTask('handle-a')?.status).toBe('Done');
    expect(second.currentTask('handle-b')?.status).toBe('Done');
    expect(first.currentTask(ENTITY)).toBeNull();
    expect(status.advanced).toEqual(
      expect.arrayContaining(['mirror:gh-main', 'mirror:gh-second']),
    );
  });

  it('skips a connection whose entity has no origin task', async () => {
    const first = registeredMirror();
    first.seed(seededTask('handle-a', 'Building'));

    const vault = new FakeVault();
    vault.connections = [connection('gh-main', 'target-a')];
    const factory = new RecordingFactory(new Map([['target-a', first]]));
    const action = new MirrorSyncAction(
      vault,
      new SyncStateAdapter(memoryStorage()),
      factory,
    );

    const records = await action.invoke('Acme');

    expect(first.currentTask('handle-a')?.status).toBe('Building');
    expect(records.every((record) => record.written.length === 0)).toBe(true);
  });
});
