import { describe, expect, it } from 'vitest';
import { AssembleProjectPassAction } from '../../../../src/core/application/actions/AssembleProjectPassAction.js';
import { CanonicalTask } from '../../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const PROJECT = 'Acme';
const ENTITY = 'Projecten/Acme/taken/fix-the-bug.md';
const TARGET = 'board-1';
const PENDING = `pendingCreation:${ENTITY}`;

class FakeVault extends FakeVaultBase {
  constructor(
    private readonly connections: readonly ConnectionDataTransferObject[],
    private readonly task: CanonicalTask | null,
  ) {
    super();
  }

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return this.connections;
  }

  override async listEntities(): Promise<readonly string[]> {
    return [ENTITY];
  }

  override async observe(
    _handle: string,
    field: string,
  ): Promise<OriginObservation> {
    return new OriginObservation({
      current: this.value(field),
      currentCompleted: this.task?.completed ?? false,
      fieldTime: null,
      trustworthy: true,
    });
  }

  override async readTask(): Promise<CanonicalTask | null> {
    return this.task;
  }

  override async applyField(): Promise<void> {}

  override async trashNote(): Promise<void> {}

  private value(field: string): string | null {
    if (this.task === null) {
      return null;
    }
    switch (field) {
      case 'title':
        return this.task.title;
      case 'body':
        return this.task.body;
      case 'Status':
        return this.task.status;
      case 'completion':
        return this.task.completed ? 'true' : 'false';
      case 'subtasks':
        return this.task.parent;
      case 'label':
        return this.task.labels.join(',');
      default:
        return null;
    }
  }
}

function originTask(): CanonicalTask {
  return new CanonicalTask({
    handle: ENTITY,
    entityId: ENTITY,
    title: 'Fix the bug',
    body: 'Body text',
    status: 'Done',
    completed: false,
    parent: null,
    labels: ['alpha', 'beta'],
  });
}

function connection(
  slug: string,
  application: string,
  target: string,
): ConnectionDataTransferObject {
  return new ConnectionDataTransferObject({
    slug,
    application,
    target,
  });
}

function setup(
  connections: readonly ConnectionDataTransferObject[] = [
    connection('gh-main', 'conformance', TARGET),
  ],
) {
  const mirror = new ConformanceMirrorAdapter();
  const mirrorAdapters: MirrorAdapterFactoryPort = {
    create: () => mirror,
  };
  const registry = new FakeSyncState();
  const action = new AssembleProjectPassAction(
    new FakeVault(connections, originTask()),
    registry,
    mirrorAdapters,
  );
  return { mirror, registry, action };
}

describe('AssembleProjectPassAction — outward materialization (F02 NWM-2)', () => {
  it('creates a vault task note once and reconciles it in the same pass', async () => {
    const { mirror, registry, action } = setup();

    const first = await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([ENTITY]);
    expect(registry.recorded).toEqual([
      {
        project: PROJECT,
        connection: 'gh-main',
        notePath: ENTITY,
        handle: PENDING,
      },
      {
        project: PROJECT,
        connection: 'gh-main',
        notePath: ENTITY,
        handle: ENTITY,
      },
    ]);
    expect(mirror.currentTask(ENTITY)?.status).toBe('Done');
    expect(
      first.some((record) => record.advanced.includes('mirror:gh-main')),
    ).toBe(true);

    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([ENTITY]);
  });

  it('skips a connection whose entity already has a mirror item', async () => {
    const { mirror, registry, action } = setup();
    mirror.seed(
      new CanonicalTask({
        handle: 'issue-1',
        entityId: ENTITY,
        title: 'Fix the bug',
        body: 'Body text',
        status: 'Done',
        completed: false,
        parent: null,
        labels: ['alpha', 'beta'],
      }),
    );
    registry.seed(
      { id: ENTITY, notePath: ENTITY },
      { 'gh-main': { handle: 'issue-1' } },
    );

    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([]);
    expect(mirror.currentTask('issue-1')?.status).toBe('Done');
  });

  it('does not duplicate the created item when recording the handle fails', async () => {
    const { mirror, registry, action } = setup();
    registry.failOnRecord = 1;

    await action.invoke(PROJECT);
    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([ENTITY]);
  });

  it('adopts the created item when stamping its handle fails', async () => {
    const { mirror, registry, action } = setup();
    registry.failOnRecord = 2;

    await action.invoke(PROJECT);
    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([ENTITY]);
    expect(registry.recorded).toContainEqual({
      project: PROJECT,
      connection: 'gh-main',
      notePath: ENTITY,
      handle: ENTITY,
    });
  });

  it('isolates a failing connection from a succeeding one', async () => {
    const good = new ConformanceMirrorAdapter();
    const bad = new ConformanceMirrorAdapter();
    bad.seedThrowingTask('board-bad');
    const registry = new FakeSyncState();
    const action = new AssembleProjectPassAction(
      new FakeVault(
        [
          connection('gh-bad', 'conformance-bad', 'board-bad'),
          connection('gh-good', 'conformance', 'board-good'),
        ],
        originTask(),
      ),
      registry,
      {
        create: (application) => (application === 'conformance' ? good : bad),
      },
    );

    await action.invoke(PROJECT);

    expect(good.createTaskCalls).toEqual([ENTITY]);
    expect(bad.createTaskCalls).toEqual([]);
  });

  it('materializes on two connections to the same application', async () => {
    const { mirror, registry, action } = setup([
      connection('gh-one', 'conformance', 'board-1'),
      connection('gh-two', 'conformance', 'board-2'),
    ]);

    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([ENTITY, ENTITY]);
    expect(registry.recorded).toEqual([
      {
        project: PROJECT,
        connection: 'gh-one',
        notePath: ENTITY,
        handle: PENDING,
      },
      {
        project: PROJECT,
        connection: 'gh-one',
        notePath: ENTITY,
        handle: ENTITY,
      },
      {
        project: PROJECT,
        connection: 'gh-two',
        notePath: ENTITY,
        handle: PENDING,
      },
      {
        project: PROJECT,
        connection: 'gh-two',
        notePath: ENTITY,
        handle: ENTITY,
      },
    ]);
  });
});
