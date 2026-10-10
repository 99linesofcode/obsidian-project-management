import { describe, expect, it } from 'vitest';
import type { CanonicalField } from '../../../../src/core/domain/canonicalField.js';
import { AdapterDescriptor } from '../../../../src/core/application/data/AdapterDescriptor.js';
import { ReconcileProjectTaskLocksAction } from '../../../../src/core/application/actions/ReconcileProjectTaskLocksAction.js';
import { AdapterRegistration } from '../../../../src/core/application/data/AdapterRegistration.js';
import { CanonicalTask } from '../../../../src/core/application/data/CanonicalTask.js';
import { ConnectionEnvelope } from '../../../../src/core/application/data/ConnectionEnvelope.js';
import { DeclaredConnection } from '../../../../src/core/application/data/DeclaredConnection.js';
import type { OriginObservation } from '../../../../src/core/application/data/OriginObservation.js';
import type { RegisteredAdapter } from '../../../../src/core/application/data/RegisteredAdapter.js';
import type { CanonicalFieldWrite } from '../../../../src/core/application/data/CanonicalFieldWrite.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { MirrorHandlePort } from '../../../../src/core/port/MirrorHandlePort.js';
import type { OriginPort } from '../../../../src/core/port/OriginPort.js';
import type { ProjectSourcePort } from '../../../../src/core/port/ProjectSourcePort.js';
import { registerAdapters } from '../../../../src/core/domain/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../../../src/infrastructure/fake/conformanceDescriptor.js';

const PROJECT = 'Acme';
const DONE = 'Shipped';
const FIX = 'Projecten/Acme/taken/fix.md';
const SHIP = 'Projecten/Acme/taken/ship.md';

class FakeProjectSource implements ProjectSourcePort {
  connections: DeclaredConnection[] = [];

  async readConnections(): Promise<readonly DeclaredConnection[]> {
    return this.connections;
  }

  async listEntities(): Promise<readonly string[]> {
    return [];
  }
}

class FakeOrigin implements OriginPort {
  readonly tasks = new Map<string, CanonicalTask>();

  async observe(
    _handle: string,
    _field: CanonicalField,
  ): Promise<OriginObservation> {
    throw new Error('not used in this test');
  }

  async readTask(handle: string): Promise<CanonicalTask | null> {
    return this.tasks.get(handle) ?? null;
  }

  async applyField(_write: CanonicalFieldWrite): Promise<void> {
    throw new Error('not used in this test');
  }

  async trash(_handle: string): Promise<void> {
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
  const projectSource = new FakeProjectSource();
  projectSource.connections = [
    new DeclaredConnection({
      slug: 'a',
      envelope: new ConnectionEnvelope({
        application: 'conformance',
        target: 'board-a',
      }),
    }),
  ];
  const mirror = new ConformanceMirrorAdapter();
  const registered: RegisteredAdapter = registerAdapters([
    new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
  ]).adapters.get('conformance')!;
  const mirrorAdapters: MirrorAdapterFactoryPort = { create: () => registered };
  const origin = new FakeOrigin();
  const handles = new FakeHandles();
  handles.seed('a', [
    { handle: 'issue-1', notePath: FIX },
    { handle: 'issue-2', notePath: SHIP },
  ]);
  const action = new ReconcileProjectTaskLocksAction(
    projectSource,
    origin,
    handles,
    mirrorAdapters,
    DONE,
  );
  return { action, mirror, origin };
}

describe("ReconcileProjectTaskLocksAction — lock a frozen project's task conversations (F02 NWM-29)", () => {
  it('locks the tracked tasks that are not done when the project freezes', async () => {
    const { action, mirror, origin } = setup();
    origin.tasks.set(FIX, task(FIX, 'Building'));
    origin.tasks.set(SHIP, task(SHIP, DONE));

    await action.invoke({ project: PROJECT, frozen: true, wasFrozen: false });

    expect([...mirror.lockedHandles]).toEqual(['issue-1']);
  });

  it('unlocks every tracked task on unfreeze, including the done lane', async () => {
    const { action, mirror, origin } = setup();
    origin.tasks.set(FIX, task(FIX, 'Building'));
    origin.tasks.set(SHIP, task(SHIP, DONE));
    await mirror.lockTask('issue-1');
    await mirror.lockTask('issue-2');

    await action.invoke({ project: PROJECT, frozen: false, wasFrozen: true });

    expect([...mirror.lockedHandles]).toEqual([]);
  });

  it('keeps unlocking the rest when one task fails to unlock', async () => {
    const { action, mirror, origin } = setup();
    origin.tasks.set(FIX, task(FIX, 'Building'));
    await mirror.lockTask('issue-1');
    await mirror.lockTask('issue-2');
    mirror.seedThrowingLock('issue-1');

    await action.invoke({ project: PROJECT, frozen: false, wasFrozen: true });

    expect([...mirror.lockedHandles]).toEqual(['issue-1']);
  });

  it('does nothing when the frozen state has not changed', async () => {
    const { action, mirror, origin } = setup();
    origin.tasks.set(FIX, task(FIX, 'Building'));

    await action.invoke({ project: PROJECT, frozen: true, wasFrozen: true });
    await action.invoke({ project: PROJECT, frozen: false, wasFrozen: false });

    expect([...mirror.lockedHandles]).toEqual([]);
  });

  it('leaves a connection alone when its adapter cannot lock tasks', async () => {
    const projectSource = new FakeProjectSource();
    projectSource.connections = [
      new DeclaredConnection({
        slug: 'a',
        envelope: new ConnectionEnvelope({
          application: 'plain',
          target: 'board-a',
        }),
      }),
    ];
    const mirror = new ConformanceMirrorAdapter();
    const base = conformanceDescriptor('plain');
    const descriptor = new AdapterDescriptor({
      applicationId: base.applicationId,
      capabilities: base.capabilities.filter(
        (capability) => capability !== 'task-locking',
      ),
      representations: base.representations,
      secretKeys: base.secretKeys,
      settingsRows: base.settingsRows,
    });
    const registered: RegisteredAdapter = registerAdapters([
      new AdapterRegistration(descriptor, mirror),
    ]).adapters.get('plain')!;
    const origin = new FakeOrigin();
    origin.tasks.set(FIX, task(FIX, 'Building'));
    const handles = new FakeHandles();
    handles.seed('a', [{ handle: 'issue-1', notePath: FIX }]);
    const action = new ReconcileProjectTaskLocksAction(
      projectSource,
      origin,
      handles,
      { create: () => registered },
      DONE,
    );

    await action.invoke({ project: PROJECT, frozen: true, wasFrozen: false });

    expect([...mirror.lockedHandles]).toEqual([]);
  });
});
