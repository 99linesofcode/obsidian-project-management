import { describe, expect, it } from 'vitest';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import { ConnectionDataTransferObject } from '../../../../src/core/application/data/ConnectionDataTransferObject.js';
import { ProjectActivityObservation } from '../../../../src/core/application/data/ProjectActivityObservation.js';
import type { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import type { RegisteredAdapter } from '../../../../src/core/application/data/RegisteredAdapter.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { RegistryPort } from '../../../../src/core/port/RegistryPort.js';
import type {
  ProjectWatchPort,
  ProjectWatchState,
} from '../../../../src/core/port/ProjectWatchPort.js';
import { ReactivateFrozenProjectAction } from '../../../../src/core/application/actions/ReactivateFrozenProjectAction.js';
import { registerAdapters } from '../../../../src/core/application/services/registerAdapters.js';
import { AdapterRegistration } from '../../../../src/core/application/data/AdapterRegistration.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../../../src/infrastructure/fake/conformanceDescriptor.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const PROJECT = 'Acme';
const TARGET = 'board-a';

class FakeVault extends FakeVaultBase {
  connections: ConnectionDataTransferObject[] = [];
  readonly moves: Array<{ project: string; archived: boolean }> = [];

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return this.connections;
  }

  override async listEntities(): Promise<readonly string[]> {
    return [];
  }

  override async observeProject(): Promise<OriginObservation> {
    throw new Error('not used in this test');
  }

  override async applyProjectArchived(
    project: string,
    archived: boolean,
  ): Promise<void> {
    this.moves.push({ project, archived });
  }
}

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

function connection(
  slug: string,
  target: string = TARGET,
): ConnectionDataTransferObject {
  return new ConnectionDataTransferObject({
    slug,
    application: 'conformance',
    target,
  });
}

function setup() {
  const vault = new FakeVault();
  vault.connections = [connection('a')];
  const registry = new SyncStateAdapter(memoryStorage());
  const watches = new FakeWatches();
  const mirror = new ConformanceMirrorAdapter();
  const registered: RegisteredAdapter = registerAdapters([
    new AdapterRegistration(conformanceDescriptor('conformance'), mirror),
  ]).adapters.get('conformance')!;
  const mirrorAdapters: MirrorAdapterFactoryPort = { create: () => registered };
  const action = new ReactivateFrozenProjectAction(
    vault,
    registry,
    mirrorAdapters,
    watches,
  );
  return { action, vault, registry, watches, mirror };
}

async function seedBaseline(
  registry: RegistryPort,
  frozen: boolean,
): Promise<void> {
  await registry.writeBaseline(
    PROJECT,
    'lifecycle',
    'origin',
    new Baseline(frozen ? 'true' : 'false', false),
  );
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
    const { action, vault, registry, watches, mirror } = setup();
    await seedBaseline(registry, true);
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
    expect(vault.moves).toEqual([{ project: PROJECT, archived: false }]);
    expect(await watches.read(PROJECT, 'a')).toEqual({
      etag: null,
      cursor: null,
    });
  });

  it('adopts the newest item as the cursor on the first watch', async () => {
    const { action, vault, registry, watches, mirror } = setup();
    await seedBaseline(registry, true);
    mirror.seedActivity(
      TARGET,
      activity(true, '2026-09-25T10:00:00Z', 'etag-2'),
    );

    const reactivated = await action.invoke(PROJECT);

    expect(reactivated).toBe(false);
    expect(vault.moves).toEqual([]);
    expect(await watches.read(PROJECT, 'a')).toEqual({
      etag: 'etag-2',
      cursor: '2026-09-25T10:00:00Z',
    });
  });

  it('refreshes only the etag when the newest item is not newer', async () => {
    const { action, vault, registry, watches, mirror } = setup();
    await seedBaseline(registry, true);
    watches.seed(PROJECT, 'a', {
      etag: 'etag-1',
      cursor: '2026-09-20T10:00:00Z',
    });
    mirror.seedActivity(
      TARGET,
      activity(true, '2026-09-20T10:00:00Z', 'etag-2'),
    );

    await action.invoke(PROJECT);

    expect(vault.moves).toEqual([]);
    expect(await watches.read(PROJECT, 'a')).toEqual({
      etag: 'etag-2',
      cursor: '2026-09-20T10:00:00Z',
    });
  });

  it('does nothing when the activity read is unchanged', async () => {
    const { action, vault, registry, watches, mirror } = setup();
    await seedBaseline(registry, true);
    mirror.seedActivity(TARGET, activity(false, null, null));

    await action.invoke(PROJECT);

    expect(vault.moves).toEqual([]);
    expect(watches.writes).toEqual([]);
  });

  it('does nothing when the project was not already frozen', async () => {
    const { action, vault, registry, mirror } = setup();
    await seedBaseline(registry, false);
    mirror.seedActivity(
      TARGET,
      activity(true, '2026-09-25T10:00:00Z', 'etag-2'),
    );

    const reactivated = await action.invoke(PROJECT);

    expect(reactivated).toBe(false);
    expect(vault.moves).toEqual([]);
  });

  it('refreshes every connection watch when one reactivates (NWM-30)', async () => {
    const { action, vault, registry, watches, mirror } = setup();
    vault.connections = [
      connection('a', 'board-a'),
      connection('b', 'board-b'),
    ];
    await seedBaseline(registry, true);
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
    expect(vault.moves).toEqual([{ project: PROJECT, archived: false }]);
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
