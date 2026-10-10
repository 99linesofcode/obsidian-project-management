import { describe, expect, it } from 'vitest';
import { Baseline } from '../../../../src/core/application/data/Baseline.js';
import { ConnectionEnvelope } from '../../../../src/core/application/data/ConnectionEnvelope.js';
import { DeclaredConnection } from '../../../../src/core/application/data/DeclaredConnection.js';
import { ProjectActivityObservation } from '../../../../src/core/application/data/ProjectActivityObservation.js';
import type { OriginObservation } from '../../../../src/core/application/data/OriginObservation.js';
import type { RegisteredAdapter } from '../../../../src/core/application/data/RegisteredAdapter.js';
import type {
  BaselineField,
  BaselineStorePort,
} from '../../../../src/core/port/BaselineStorePort.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { ProjectLifecycleOriginPort } from '../../../../src/core/port/ProjectLifecycleOriginPort.js';
import type { ProjectSourcePort } from '../../../../src/core/port/ProjectSourcePort.js';
import type {
  ProjectWatchPort,
  ProjectWatchState,
} from '../../../../src/core/port/ProjectWatchPort.js';
import { ReactivateFrozenProjectAction } from '../../../../src/core/application/actions/ReactivateFrozenProjectAction.js';
import { registerAdapters } from '../../../../src/core/domain/registerAdapters.js';
import { AdapterRegistration } from '../../../../src/core/application/data/AdapterRegistration.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../../../src/infrastructure/fake/conformanceDescriptor.js';

const PROJECT = 'Acme';
const TARGET = 'board-a';

class FakeProjectSource implements ProjectSourcePort {
  connections: DeclaredConnection[] = [];

  async readConnections(): Promise<readonly DeclaredConnection[]> {
    return this.connections;
  }

  async listEntities(): Promise<readonly string[]> {
    return [];
  }
}

class FakeOrigin implements ProjectLifecycleOriginPort {
  readonly moves: Array<{ project: string; archived: boolean }> = [];

  async observeProject(): Promise<OriginObservation> {
    throw new Error('not used in this test');
  }

  async applyProjectArchived(
    project: string,
    archived: boolean,
  ): Promise<void> {
    this.moves.push({ project, archived });
  }
}

class FakeBaselines implements BaselineStorePort {
  private readonly values = new Map<string, Baseline>();

  seed(project: string, side: string, value: string): void {
    this.values.set(`${project}\u0000${side}`, new Baseline(value, false));
  }

  async read(
    entityId: string,
    _field: BaselineField,
    side: string,
  ): Promise<Baseline | null> {
    return this.values.get(`${entityId}\u0000${side}`) ?? null;
  }

  async write(): Promise<void> {}
}

class FakeWatches implements ProjectWatchPort {
  private readonly states = new Map<string, ProjectWatchState>();
  readonly writes: Array<{ project: string; connection: string }> = [];

  seed(project: string, connection: string, state: ProjectWatchState): void {
    this.states.set(`${project}\u0000${connection}`, state);
  }

  async read(project: string, connection: string): Promise<ProjectWatchState> {
    return (
      this.states.get(`${project}\u0000${connection}`) ?? {
        etag: null,
        cursor: null,
      }
    );
  }

  async write(
    project: string,
    connection: string,
    state: ProjectWatchState,
  ): Promise<void> {
    this.states.set(`${project}\u0000${connection}`, state);
    this.writes.push({ project, connection });
  }
}

function connection(slug: string, target: string = TARGET): DeclaredConnection {
  return new DeclaredConnection({
    slug,
    envelope: new ConnectionEnvelope({
      application: 'conformance',
      target,
    }),
  });
}

function setup() {
  const projectSource = new FakeProjectSource();
  projectSource.connections = [connection('a')];
  const origin = new FakeOrigin();
  const baselines = new FakeBaselines();
  const watches = new FakeWatches();
  const mirror = new ConformanceMirrorAdapter();
  const registered: RegisteredAdapter = registerAdapters([
    new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
  ]).adapters.get('conformance')!;
  const mirrorAdapters: MirrorAdapterFactoryPort = { create: () => registered };
  const action = new ReactivateFrozenProjectAction(
    projectSource,
    origin,
    baselines,
    mirrorAdapters,
    watches,
  );
  return { action, origin, baselines, watches, mirror, projectSource };
}

function activity(
  changed: boolean,
  newestCreatedAt: string | null,
  etag: string | null,
): ProjectActivityObservation {
  return new ProjectActivityObservation({ changed, newestCreatedAt, etag });
}

describe('ReactivateFrozenProjectAction — a newer mirror item reopens a frozen project (F02 NWM-30)', () => {
  it('unfreezes the origin and clears the watch when a newer item appears', async () => {
    const { action, origin, baselines, watches, mirror } = setup();
    baselines.seed(PROJECT, 'origin', 'true');
    watches.seed(PROJECT, 'a', {
      etag: 'etag-1',
      cursor: '2026-09-20T10:00:00Z',
    });
    mirror.seedActivity(
      TARGET,
      activity(true, '2026-09-25T10:00:00Z', 'etag-2'),
    );

    const reactivated = await action.invoke(PROJECT);

    expect(reactivated).toBe(true);
    expect(origin.moves).toEqual([{ project: PROJECT, archived: false }]);
    expect(await watches.read(PROJECT, 'a')).toEqual({
      etag: null,
      cursor: null,
    });
  });

  it('adopts the newest item as the cursor on the first watch', async () => {
    const { action, origin, baselines, watches, mirror } = setup();
    baselines.seed(PROJECT, 'origin', 'true');
    mirror.seedActivity(
      TARGET,
      activity(true, '2026-09-25T10:00:00Z', 'etag-2'),
    );

    const reactivated = await action.invoke(PROJECT);

    expect(reactivated).toBe(false);
    expect(origin.moves).toEqual([]);
    expect(await watches.read(PROJECT, 'a')).toEqual({
      etag: 'etag-2',
      cursor: '2026-09-25T10:00:00Z',
    });
  });

  it('refreshes only the etag when the newest item is not newer', async () => {
    const { action, origin, baselines, watches, mirror } = setup();
    baselines.seed(PROJECT, 'origin', 'true');
    watches.seed(PROJECT, 'a', {
      etag: 'etag-1',
      cursor: '2026-09-20T10:00:00Z',
    });
    mirror.seedActivity(
      TARGET,
      activity(true, '2026-09-20T10:00:00Z', 'etag-2'),
    );

    await action.invoke(PROJECT);

    expect(origin.moves).toEqual([]);
    expect(await watches.read(PROJECT, 'a')).toEqual({
      etag: 'etag-2',
      cursor: '2026-09-20T10:00:00Z',
    });
  });

  it('does nothing when the activity read is unchanged', async () => {
    const { action, origin, baselines, watches, mirror } = setup();
    baselines.seed(PROJECT, 'origin', 'true');
    mirror.seedActivity(TARGET, activity(false, null, null));

    await action.invoke(PROJECT);

    expect(origin.moves).toEqual([]);
    expect(watches.writes).toEqual([]);
  });

  it('does nothing when the project was not already frozen', async () => {
    const { action, origin, baselines, mirror } = setup();
    baselines.seed(PROJECT, 'origin', 'false');
    mirror.seedActivity(
      TARGET,
      activity(true, '2026-09-25T10:00:00Z', 'etag-2'),
    );

    const reactivated = await action.invoke(PROJECT);

    expect(reactivated).toBe(false);
    expect(origin.moves).toEqual([]);
  });

  it('refreshes every connection watch when one reactivates (NWM-30)', async () => {
    const { action, origin, baselines, watches, mirror, projectSource } =
      setup();
    projectSource.connections = [
      connection('a', 'board-a'),
      connection('b', 'board-b'),
    ];
    baselines.seed(PROJECT, 'origin', 'true');
    watches.seed(PROJECT, 'a', {
      etag: 'etag-a1',
      cursor: '2026-09-20T10:00:00Z',
    });
    watches.seed(PROJECT, 'b', {
      etag: 'etag-b1',
      cursor: '2026-09-20T10:00:00Z',
    });
    mirror.seedActivity(
      'board-a',
      activity(true, '2026-09-25T10:00:00Z', 'etag-a2'),
    );
    mirror.seedActivity(
      'board-b',
      activity(true, '2026-09-20T10:00:00Z', 'etag-b2'),
    );

    const reactivated = await action.invoke(PROJECT);

    expect(reactivated).toBe(true);
    expect(origin.moves).toEqual([{ project: PROJECT, archived: false }]);
    expect(await watches.read(PROJECT, 'a')).toEqual({
      etag: null,
      cursor: null,
    });
    expect(await watches.read(PROJECT, 'b')).toEqual({
      etag: 'etag-b2',
      cursor: '2026-09-20T10:00:00Z',
    });
  });
});
