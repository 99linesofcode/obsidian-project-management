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
  async readConnections(): Promise<readonly DeclaredConnection[]> {
    return [
      new DeclaredConnection({
        slug: 'gh-main',
        envelope: new ConnectionEnvelope({
          application: 'conformance',
          target: TARGET,
        }),
      }),
    ];
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

function setup() {
  const mirror = new ConformanceMirrorAdapter();
  const registered: RegisteredAdapter = registerAdapters([
    new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
  ]).adapters.get('conformance')!;
  const mirrorAdapters: MirrorAdapterFactoryPort = {
    create: () => registered,
  };
  const handles = new RecordingHandles();
  const action = new AssembleProjectPassAction(
    new FixedProjectSource(),
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
});
