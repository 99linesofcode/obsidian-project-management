import { describe, expect, it } from 'vitest';
import { CaptureTasksAction } from '../../src/core/CaptureTasksAction.js';
import { CanonicalTask } from '../../src/core/data/CanonicalTask.js';
import { ConnectionEnvelope } from '../../src/core/data/ConnectionEnvelope.js';
import { DeclaredConnection } from '../../src/core/data/DeclaredConnection.js';
import { RegisteredAdapter } from '../../src/core/data/RegisteredAdapter.js';
import type { CapturePort } from '../../src/core/ports/CapturePort.js';
import type { MirrorAdapterFactoryPort } from '../../src/core/ports/MirrorAdapterFactoryPort.js';
import type { ProjectPort } from '../../src/core/ports/ProjectPort.js';
import type { ProjectSourcePort } from '../../src/core/ports/ProjectSourcePort.js';
import type { TaskSurfacePort } from '../../src/core/ports/TaskSurfacePort.js';
import type {
  AdoptTaskInput,
  TaskCaptureVaultPort,
} from '../../src/core/ports/TaskCaptureVaultPort.js';
import { conformanceDescriptor } from '../../src/infrastructure/fake/conformanceDescriptor.js';

const SYNCED_AT = '2026-10-08T12:00:00Z';

class FakeVault implements TaskCaptureVaultPort {
  readonly adopted = new Map<string, Set<string>>();
  readonly adoptCalls: Array<{ handle: string; slug: string }> = [];
  failOn: string | null = null;

  async listAdopted(project: string, slug: string): Promise<readonly string[]> {
    return [...(this.adopted.get(`${project}/${slug}`) ?? [])];
  }

  async adopt(input: AdoptTaskInput): Promise<void> {
    if (input.task.handle === this.failOn) {
      throw new Error(`adopt failed: ${input.task.handle}`);
    }
    this.adoptCalls.push({ handle: input.task.handle, slug: input.slug });
    const key = `${input.projectName}/${input.slug}`;
    const handles = this.adopted.get(key) ?? new Set<string>();
    handles.add(input.task.handle);
    this.adopted.set(key, handles);
  }
}

class FakeProjectSource implements ProjectSourcePort {
  constructor(private readonly connections: readonly DeclaredConnection[]) {}

  async readConnections(): Promise<readonly DeclaredConnection[]> {
    return this.connections;
  }

  async listEntities(): Promise<readonly string[]> {
    return [];
  }
}

function task(handle: string): CanonicalTask {
  return new CanonicalTask({
    handle,
    entityId: handle,
    title: handle,
    body: '',
    status: '',
    completed: false,
    parent: null,
    labels: [],
  });
}

function connection(
  application: string,
  target: string,
  slug: string,
): DeclaredConnection {
  return new DeclaredConnection({
    slug,
    envelope: new ConnectionEnvelope({ application, target }),
  });
}

function registered(capture: CapturePort): RegisteredAdapter {
  return new RegisteredAdapter({
    descriptor: conformanceDescriptor('acme'),
    project: {} as ProjectPort,
    tasks: {} as TaskSurfacePort,
    capture,
    projectCapture: undefined,
    completeFetch: undefined,
    timestamps: undefined,
  });
}

function harness(
  tasks: CanonicalTask[],
  connections: readonly DeclaredConnection[] = [
    connection('acme', 'T1', 'acme'),
  ],
): {
  action: CaptureTasksAction;
  vault: FakeVault;
  listing: { tasks: CanonicalTask[] };
} {
  const vault = new FakeVault();
  const listing = { tasks };
  const factory: MirrorAdapterFactoryPort = {
    create: () => registered({ capture: async () => listing.tasks }),
  };
  return {
    action: new CaptureTasksAction(
      new FakeProjectSource(connections),
      factory,
      vault,
    ),
    vault,
    listing,
  };
}

describe('CaptureTasksAction — adopting application-born tasks', () => {
  it('adopts a mirror-born task exactly once', async () => {
    const h = harness([task('A')]);

    const first = await h.action.invoke('Acme', SYNCED_AT);
    const second = await h.action.invoke('Acme', SYNCED_AT);

    expect(first.captured).toEqual(['A']);
    expect(second.captured).toEqual([]);
    expect(h.vault.adoptCalls.map((call) => call.handle)).toEqual(['A']);
  });

  it('adopts a task ordered before a previously adopted one', async () => {
    const h = harness([task('A')]);
    await h.action.invoke('Acme', SYNCED_AT);
    h.listing.tasks = [task('N'), task('A')];

    const result = await h.action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual(['N']);
    expect(h.vault.adoptCalls.map((call) => call.handle)).toEqual(['A', 'N']);
  });

  it('skips a task the vault already declares', async () => {
    const h = harness([task('A')]);
    h.vault.adopted.set('Acme/acme', new Set(['A']));

    const result = await h.action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([]);
  });

  it('does not lose the remaining tasks when one adoption fails', async () => {
    const h = harness([task('A'), task('B'), task('C')]);
    h.vault.failOn = 'B';

    const first = await h.action.invoke('Acme', SYNCED_AT);
    h.vault.failOn = null;
    const second = await h.action.invoke('Acme', SYNCED_AT);

    expect(first.captured).toEqual(['A']);
    expect(first.errors).toHaveLength(1);
    expect(second.captured).toEqual(['B', 'C']);
    expect(h.vault.adoptCalls.map((call) => call.handle)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('skips a connection whose adapter declares no capture', async () => {
    const vault = new FakeVault();
    const factory: MirrorAdapterFactoryPort = { create: () => null };
    const action = new CaptureTasksAction(
      new FakeProjectSource([connection('acme', 'T1', 'acme')]),
      factory,
      vault,
    );

    const result = await action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual([]);
    expect(vault.adoptCalls).toEqual([]);
  });

  it('captures each connection independently', async () => {
    const vault = new FakeVault();
    const factory: MirrorAdapterFactoryPort = {
      create: (application) =>
        registered({
          capture: async () => [task(application === 'acme' ? 'A' : 'B')],
        }),
    };
    const action = new CaptureTasksAction(
      new FakeProjectSource([
        connection('acme', 'T1', 'acme'),
        connection('other', 'T2', 'other'),
      ]),
      factory,
      vault,
    );

    const result = await action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual(['A', 'B']);
    expect(vault.adoptCalls).toEqual([
      { handle: 'A', slug: 'acme' },
      { handle: 'B', slug: 'other' },
    ]);
  });

  it('isolates a connection whose listing fails and captures the rest', async () => {
    const vault = new FakeVault();
    const factory: MirrorAdapterFactoryPort = {
      create: (application) =>
        registered({
          capture: async () => {
            if (application === 'acme') {
              throw new Error('listing failed');
            }
            return [task('B')];
          },
        }),
    };
    const action = new CaptureTasksAction(
      new FakeProjectSource([
        connection('acme', 'T1', 'acme'),
        connection('other', 'T2', 'other'),
      ]),
      factory,
      vault,
    );

    const result = await action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual(['B']);
    expect(result.errors).toHaveLength(1);
    expect(vault.adoptCalls).toEqual([{ handle: 'B', slug: 'other' }]);
  });
});
