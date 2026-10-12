import { describe, expect, it } from 'vitest';
import { AssembleProjectPassAction } from '../../../../src/core/application/actions/AssembleProjectPassAction.js';
import { AdapterRegistration } from '../../../../src/core/application/data/AdapterRegistration.js';
import { CanonicalTask } from '../../../../src/core/application/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../src/core/application/data/ConnectionDataTransferObject.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import type { RegisteredAdapter } from '../../../../src/core/application/data/RegisteredAdapter.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { registerAdapters } from '../../../../src/core/application/services/registerAdapters.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../../../src/infrastructure/fake/conformanceDescriptor.js';
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
  vault.values.set('label', '');
  return vault;
}

class RecordingFactory implements MirrorAdapterFactoryPort {
  readonly calls: Array<{ application: string; target: string }> = [];

  constructor(
    private readonly adapters: ReadonlyMap<string, RegisteredAdapter>,
  ) {}

  create(application: string, target: string): RegisteredAdapter | null {
    this.calls.push({ application, target });
    return this.adapters.get(target) ?? null;
  }
}

function registeredMirror(applicationId: string): {
  adapter: ConformanceMirrorAdapter;
  registered: RegisteredAdapter;
} {
  const adapter = new ConformanceMirrorAdapter();
  const registered = registerAdapters([
    new AdapterRegistration(conformanceDescriptor(applicationId), adapter),
  ]).adapters.get(applicationId)!;
  return { adapter, registered };
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

describe('AssembleProjectPassAction — entity to per-connection handle (F02 NWM-2)', () => {
  it('resolves each connection its own handle and scopes the adapter by target', async () => {
    const first = registeredMirror('mirror-a');
    const second = registeredMirror('mirror-b');
    first.adapter.seed(seededTask('handle-a', 'Building'));
    second.adapter.seed(seededTask('handle-b', 'Building'));

    const vault = new FakeVault();
    vault.connections = [
      connection('gh-main', 'target-a'),
      connection('gh-second', 'target-b'),
    ];
    mirrorLikeOrigin('Done', vault);
    const factory = new RecordingFactory(
      new Map([
        ['target-a', first.registered],
        ['target-b', second.registered],
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
    const action = new AssembleProjectPassAction(vault, registry, factory);

    const records = await action.invoke('Acme');
    const status = records.find((record) => record.field === 'Status')!;

    expect(factory.calls).toEqual([
      { application: 'github', target: 'target-a' },
      { application: 'github', target: 'target-b' },
    ]);
    expect(first.adapter.currentTask('handle-a')?.status).toBe('Done');
    expect(second.adapter.currentTask('handle-b')?.status).toBe('Done');
    expect(first.adapter.currentTask(ENTITY)).toBeNull();
    expect(status.advanced).toEqual(
      expect.arrayContaining(['mirror:gh-main', 'mirror:gh-second']),
    );
  });

  it('skips a connection whose entity has no origin task', async () => {
    const first = registeredMirror('mirror-a');
    first.adapter.seed(seededTask('handle-a', 'Building'));

    const vault = new FakeVault();
    vault.connections = [connection('gh-main', 'target-a')];
    const factory = new RecordingFactory(
      new Map([['target-a', first.registered]]),
    );
    const action = new AssembleProjectPassAction(
      vault,
      new SyncStateAdapter(memoryStorage()),
      factory,
    );

    const records = await action.invoke('Acme');

    expect(first.adapter.currentTask('handle-a')?.status).toBe('Building');
    expect(records.every((record) => record.written.length === 0)).toBe(true);
  });
});
