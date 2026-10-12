import { describe, expect, it } from 'vitest';
import type { CanonicalField } from '../../../../src/core/domain/canonicalField.js';
import { AdapterDescriptor } from '../../../../src/core/application/data/AdapterDescriptor.js';
import { ReconcileProjectTaskLocksAction } from '../../../../src/core/application/actions/ReconcileProjectTaskLocksAction.js';
import { AdapterRegistration } from '../../../../src/core/application/data/AdapterRegistration.js';
import { CanonicalTask } from '../../../../src/core/application/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../src/core/application/data/ConnectionDataTransferObject.js';
import type { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import type { RegisteredAdapter } from '../../../../src/core/application/data/RegisteredAdapter.js';
import type { CanonicalFieldWrite } from '../../../../src/core/application/data/CanonicalFieldWrite.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { MirrorHandlePort } from '../../../../src/core/port/MirrorHandlePort.js';
import { registerAdapters } from '../../../../src/core/application/services/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../../../src/infrastructure/fake/conformanceDescriptor.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const PROJECT = 'Acme';
const DONE = 'Shipped';
const FIX = 'Projecten/Acme/taken/fix.md';
const SHIP = 'Projecten/Acme/taken/ship.md';

class FakeVault extends FakeVaultBase {
  connections: ConnectionDataTransferObject[] = [];
  readonly tasks = new Map<string, CanonicalTask>();

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return this.connections;
  }

  override async listEntities(): Promise<readonly string[]> {
    return [];
  }

  override async observe(
    _handle: string,
    _field: CanonicalField,
  ): Promise<OriginObservation> {
    throw new Error('not used in this test');
  }

  override async readTask(handle: string): Promise<CanonicalTask | null> {
    return this.tasks.get(handle) ?? null;
  }

  override async applyField(_write: CanonicalFieldWrite): Promise<void> {
    throw new Error('not used in this test');
  }

  override async trashNote(_handle: string): Promise<void> {
    throw new Error('not used in this test');
  }
}

class FakeHandles implements MirrorHandlePort {
  private readonly listed = new Map<
    string,
    Array<{ handle: string; notePath: string }>
  >();

  seed(
    connection: string,
    entries: Array<{ handle: string; notePath: string }>,
  ): void {
    this.listed.set(connection, entries);
  }

  async resolve(): Promise<string | null> {
    return null;
  }

  async list(
    _project: string,
    connection: string,
  ): Promise<readonly { handle: string; notePath: string }[]> {
    return this.listed.get(connection) ?? [];
  }

  async record(): Promise<void> {}
}

function task(notePath: string, status: string): CanonicalTask {
  return new CanonicalTask({
    handle: notePath,
    entityId: notePath,
    title: 'Task',
    body: '',
    status,
    completed: false,
    parent: null,
    labels: [],
  });
}

function setup() {
  const vault = new FakeVault();
  vault.connections = [
    new ConnectionDataTransferObject({
      slug: 'a',
      application: 'conformance',
      target: 'board-a',
    }),
  ];
  const mirror = new ConformanceMirrorAdapter();
  const registered: RegisteredAdapter = registerAdapters([
    new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
  ]).adapters.get('conformance')!;
  const mirrorAdapters: MirrorAdapterFactoryPort = { create: () => registered };
  const handles = new FakeHandles();
  handles.seed('a', [
    { handle: 'issue-1', notePath: FIX },
    { handle: 'issue-2', notePath: SHIP },
  ]);
  const action = new ReconcileProjectTaskLocksAction(
    vault,
    handles,
    mirrorAdapters,
    DONE,
  );
  return { action, mirror, vault };
}

describe("ReconcileProjectTaskLocksAction — lock a frozen project's task conversations (F02 NWM-29)", () => {
  it('locks the tracked tasks that are not done when the project freezes', async () => {
    const { action, mirror, vault } = setup();
    vault.tasks.set(FIX, task(FIX, 'Building'));
    vault.tasks.set(SHIP, task(SHIP, DONE));

    await action.invoke({ project: PROJECT, frozen: true, wasFrozen: false });

    expect([...mirror.lockedHandles]).toEqual(['issue-1']);
  });

  it('unlocks every tracked task on unfreeze, including the done lane', async () => {
    const { action, mirror, vault } = setup();
    vault.tasks.set(FIX, task(FIX, 'Building'));
    vault.tasks.set(SHIP, task(SHIP, DONE));
    await mirror.lockTask('issue-1');
    await mirror.lockTask('issue-2');

    await action.invoke({ project: PROJECT, frozen: false, wasFrozen: true });

    expect([...mirror.lockedHandles]).toEqual([]);
  });

  it('keeps unlocking the rest when one task fails to unlock', async () => {
    const { action, mirror, vault } = setup();
    vault.tasks.set(FIX, task(FIX, 'Building'));
    await mirror.lockTask('issue-1');
    await mirror.lockTask('issue-2');
    mirror.seedThrowingLock('issue-1');

    await action.invoke({ project: PROJECT, frozen: false, wasFrozen: true });

    expect([...mirror.lockedHandles]).toEqual(['issue-1']);
  });

  it('does nothing when the frozen state has not changed', async () => {
    const { action, mirror, vault } = setup();
    vault.tasks.set(FIX, task(FIX, 'Building'));

    await action.invoke({ project: PROJECT, frozen: true, wasFrozen: true });
    await action.invoke({ project: PROJECT, frozen: false, wasFrozen: false });

    expect([...mirror.lockedHandles]).toEqual([]);
  });

  it('leaves a connection alone when its adapter cannot lock tasks', async () => {
    const vault = new FakeVault();
    vault.connections = [
      new ConnectionDataTransferObject({
        slug: 'a',
        application: 'plain',
        target: 'board-a',
      }),
    ];
    const mirror = new ConformanceMirrorAdapter();
    const base = conformanceDescriptor('plain');
    const descriptor = new AdapterDescriptor({
      applicationId: base.applicationId,
      capabilities: base.capabilities.filter(
        (capability) => capability !== 'task-locking',
      ),
      secretKeys: base.secretKeys,
      settingsRows: base.settingsRows,
    });
    const registered: RegisteredAdapter = registerAdapters([
      new AdapterRegistration(descriptor, mirror),
    ]).adapters.get('plain')!;
    vault.tasks.set(FIX, task(FIX, 'Building'));
    const handles = new FakeHandles();
    handles.seed('a', [{ handle: 'issue-1', notePath: FIX }]);
    const action = new ReconcileProjectTaskLocksAction(
      vault,
      handles,
      { create: () => registered },
      DONE,
    );

    await action.invoke({ project: PROJECT, frozen: true, wasFrozen: false });

    expect([...mirror.lockedHandles]).toEqual([]);
  });
});
