import { describe, expect, it } from 'vitest';
import { AssembleProjectPassAction } from '../../src/core/AssembleProjectPassAction.js';
import { AdapterRegistration } from '../../src/core/data/AdapterRegistration.js';
import type { Baseline } from '../../src/core/data/Baseline.js';
import { CanonicalTask } from '../../src/core/data/CanonicalTask.js';
import { ConnectionEnvelope } from '../../src/core/data/ConnectionEnvelope.js';
import { DeclaredConnection } from '../../src/core/data/DeclaredConnection.js';
import { OriginObservation } from '../../src/core/data/OriginObservation.js';
import type { RegisteredAdapter } from '../../src/core/data/RegisteredAdapter.js';
import type { BaselineStorePort } from '../../src/core/ports/BaselineStorePort.js';
import type { MirrorAdapterFactoryPort } from '../../src/core/ports/MirrorAdapterFactoryPort.js';
import type { MirrorHandlePort } from '../../src/core/ports/MirrorHandlePort.js';
import type { OriginPort } from '../../src/core/ports/OriginPort.js';
import type { ProjectSourcePort } from '../../src/core/ports/ProjectSourcePort.js';
import { registerAdapters } from '../../src/core/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../src/infrastructure/fake/conformanceDescriptor.js';

const PROJECT = 'Acme';
const ENTITY = 'Projecten/Acme/taken/fix-the-bug.md';
const TARGET = 'board-1';
const PENDING = `pendingCreation:${ENTITY}`;

class MemoryBaselines implements BaselineStorePort {
  private readonly baselines = new Map<string, Baseline>();

  async read(
    entityId: string,
    field: string,
    side: string,
  ): Promise<Baseline | null> {
    return this.baselines.get(`${entityId}\u0000${field}\u0000${side}`) ?? null;
  }

  async write(
    entityId: string,
    field: string,
    side: string,
    baseline: Baseline,
  ): Promise<void> {
    this.baselines.set(`${entityId}\u0000${field}\u0000${side}`, baseline);
  }
}

class FixedProjectSource implements ProjectSourcePort {
  constructor(private readonly connections: readonly DeclaredConnection[]) {}

  async readConnections(): Promise<readonly DeclaredConnection[]> {
    return this.connections;
  }

  async listEntities(): Promise<readonly string[]> {
    return [ENTITY];
  }
}

class TaskOrigin implements OriginPort {
  constructor(private readonly task: CanonicalTask | null) {}

  async observe(_handle: string, field: string): Promise<OriginObservation> {
    return new OriginObservation({
      current: this.value(field),
      currentCompleted: this.task?.completed ?? false,
      fieldTime: null,
      trustworthy: true,
    });
  }

  async readTask(): Promise<CanonicalTask | null> {
    return this.task;
  }

  async applyField(): Promise<void> {}

  async trash(): Promise<void> {}

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

class RecordingHandles implements MirrorHandlePort {
  readonly recorded: Array<{
    project: string;
    connection: string;
    notePath: string;
    handle: string;
  }> = [];
  failOnRecord = 0;
  private recordCount = 0;
  private readonly handles = new Map<string, string>();

  seed(connection: string, notePath: string, handle: string): void {
    this.handles.set(`${connection}\u0000${notePath}`, handle);
  }

  async resolve(connection: string, notePath: string): Promise<string | null> {
    return this.handles.get(`${connection}\u0000${notePath}`) ?? null;
  }

  async record(
    project: string,
    connection: string,
    notePath: string,
    handle: string,
  ): Promise<void> {
    this.recordCount++;
    if (this.recordCount === this.failOnRecord) {
      throw new Error('registry write failed');
    }
    this.recorded.push({ project, connection, notePath, handle });
    this.handles.set(`${connection}\u0000${notePath}`, handle);
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
): DeclaredConnection {
  return new DeclaredConnection({
    slug,
    envelope: new ConnectionEnvelope({ application, target }),
  });
}

function registeredMirror(
  application: string,
  mirror: ConformanceMirrorAdapter,
): RegisteredAdapter {
  return registerAdapters([
    new AdapterRegistration(conformanceDescriptor(application), mirror),
  ]).adapters.get(application)!;
}

function setup(
  connections: readonly DeclaredConnection[] = [
    connection('gh-main', 'conformance', TARGET),
  ],
) {
  const mirror = new ConformanceMirrorAdapter();
  const registered = registeredMirror('conformance', mirror);
  const mirrorAdapters: MirrorAdapterFactoryPort = {
    create: () => registered,
  };
  const handles = new RecordingHandles();
  const action = new AssembleProjectPassAction(
    new FixedProjectSource(connections),
    new TaskOrigin(originTask()),
    new MemoryBaselines(),
    handles,
    mirrorAdapters,
  );
  return { mirror, handles, action };
}

describe('AssembleProjectPassAction — outward materialization (F02 NWM-2)', () => {
  it('creates a vault task note once and reconciles it in the same pass', async () => {
    const { mirror, handles, action } = setup();

    const first = await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([ENTITY]);
    expect(handles.recorded).toEqual([
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
    const { mirror, handles, action } = setup();
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
    handles.seed('gh-main', ENTITY, 'issue-1');

    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([]);
    expect(mirror.currentTask('issue-1')?.status).toBe('Done');
  });

  it('does not duplicate the created item when recording the handle fails', async () => {
    const { mirror, handles, action } = setup();
    handles.failOnRecord = 1;

    await action.invoke(PROJECT);
    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([ENTITY]);
  });

  it('adopts the created item when stamping its handle fails', async () => {
    const { mirror, handles, action } = setup();
    handles.failOnRecord = 2;

    await action.invoke(PROJECT);
    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([ENTITY]);
    expect(handles.recorded).toContainEqual({
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
    const handles = new RecordingHandles();
    const action = new AssembleProjectPassAction(
      new FixedProjectSource([
        connection('gh-bad', 'conformance-bad', 'board-bad'),
        connection('gh-good', 'conformance', 'board-good'),
      ]),
      new TaskOrigin(originTask()),
      new MemoryBaselines(),
      handles,
      {
        create: (application) =>
          application === 'conformance'
            ? registeredMirror('conformance', good)
            : registeredMirror('conformance-bad', bad),
      },
    );

    await action.invoke(PROJECT);

    expect(good.createTaskCalls).toEqual([ENTITY]);
    expect(bad.createTaskCalls).toEqual([]);
  });

  it('materializes on two connections to the same application', async () => {
    const { mirror, handles, action } = setup([
      connection('gh-one', 'conformance', 'board-1'),
      connection('gh-two', 'conformance', 'board-2'),
    ]);

    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([ENTITY, ENTITY]);
    expect(handles.recorded).toEqual([
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
