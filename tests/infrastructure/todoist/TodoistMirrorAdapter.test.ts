import { describe, expect, it } from 'vitest';
import { Baseline } from '../../../src/core/domain/Baseline.js';
import { CanonicalFieldWrite } from '../../../src/core/port/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../src/core/port/data/ConnectionDataTransferObject.js';
import { OriginObservation } from '../../../src/core/domain/OriginObservation.js';
import { MirrorSyncAction } from '../../../src/core/application/actions/MirrorSyncAction.js';
import { TodoistMirrorAdapter } from '../../../src/infrastructure/todoist/TodoistMirrorAdapter.js';
import type { TodoistTransport } from '../../../src/infrastructure/todoist/TodoistTransport.js';
import { SyncStateAdapter } from '../../../src/infrastructure/registry/SyncStateAdapter.js';
import { FakeVault as FakeVaultBase } from '../../helpers/fakeVault.js';

function target(): string {
  return 'P1';
}

interface RecordedCall {
  method: string;
  path: string;
  body: string;
}

class FakeTransport implements TodoistTransport {
  readonly calls: RecordedCall[] = [];
  private readonly responses: Array<{ status: number; json: unknown }>;

  constructor(responses: Array<{ status: number; json: unknown }>) {
    this.responses = [...responses];
  }

  async get(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'GET', path, body: '' });
    return this.next();
  }

  async post(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'POST', path, body });
    return this.next();
  }

  async delete(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'DELETE', path, body: '' });
    return this.next();
  }

  private next(): { status: number; json: unknown } {
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error('fake transport: no more responses queued');
    }
    return response;
  }
}

function taskNode(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'T1',
    project_id: 'P1',
    section_id: 'S1',
    parent_id: null,
    content: 'Fix the bug',
    description: 'The bug happens on resize.',
    labels: ['type: task'],
    checked: false,
    added_at: '2026-09-18T09:00:00Z',
    updated_at: '2026-09-18T10:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

function sectionNode(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: 'S1', project_id: 'P1', name: 'Building', ...overrides };
}

function adapterWith(
  responses: Array<{ status: number; json: unknown }>,
  now: () => Date = () => new Date(),
): {
  adapter: TodoistMirrorAdapter;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(responses);
  return {
    adapter: new TodoistMirrorAdapter(transport, target(), now),
    transport,
  };
}

describe('TodoistMirrorAdapter — the canonical read (F01 ACM-5)', () => {
  it('maps the task and its section onto the canonical task', async () => {
    const { adapter } = adapterWith([
      { status: 200, json: taskNode() },
      { status: 200, json: [sectionNode()] },
    ]);

    const task = await adapter.readTask('T1');

    expect(task).not.toBeNull();
    expect(task!.handle).toBe('T1');
    expect(task!.entityId).toBe('T1');
    expect(task!.title).toBe('Fix the bug');
    expect(task!.body).toBe('The bug happens on resize.');
    expect(task!.status).toBe('Building');
    expect(task!.completed).toBe(false);
    expect(task!.parent).toBeNull();
    expect(task!.labels).toEqual(['type: task']);
  });

  it('reads a checked task as completion, with its parent relation', async () => {
    const { adapter } = adapterWith([
      {
        status: 200,
        json: taskNode({
          checked: true,
          completed_at: '2026-09-24T11:00:00Z',
          parent_id: 'T0',
        }),
      },
      { status: 200, json: [sectionNode()] },
    ]);

    const task = await adapter.readTask('T1');

    expect(task!.completed).toBe(true);
    expect(task!.parent).toBe('T0');
    expect(task!.status).toBe('Building');
  });

  it('reads a section-less task with no lane', async () => {
    const { adapter } = adapterWith([
      { status: 200, json: taskNode({ section_id: null }) },
      { status: 200, json: [sectionNode()] },
    ]);

    const task = await adapter.readTask('T1');

    expect(task!.status).toBe('');
  });

  it('returns null for a single task without a type label (LBL-4)', async () => {
    const { adapter } = adapterWith([
      { status: 200, json: taskNode({ labels: ['bug'] }) },
      { status: 200, json: [sectionNode()] },
    ]);

    expect(await adapter.readTask('T1')).toBeNull();
  });
});

describe('TodoistMirrorAdapter — the canonical writes (F01 ACM-5)', () => {
  it('writes a title through the task content', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: taskNode({ content: 'New title' }) },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'title',
        value: 'New title',
      }),
    );

    expect(transport.calls[0]).toEqual({
      method: 'POST',
      path: '/tasks/T1',
      body: JSON.stringify({ content: 'New title' }),
    });
  });

  it('writes a body through the task description', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: taskNode({ description: 'New body' }) },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'body',
        value: 'New body',
      }),
    );

    expect(transport.calls[0]!.body).toBe(
      JSON.stringify({ description: 'New body' }),
    );
  });

  it('writes completion through the close endpoint', async () => {
    const { adapter, transport } = adapterWith([{ status: 204, json: null }]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'completion',
        value: 'true',
      }),
    );

    expect(transport.calls[0]).toEqual({
      method: 'POST',
      path: '/tasks/T1/close',
      body: '',
    });
  });

  it('reopens a task through the reopen endpoint', async () => {
    const { adapter, transport } = adapterWith([{ status: 204, json: null }]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'completion',
        value: 'false',
      }),
    );

    expect(transport.calls[0]!.path).toBe('/tasks/T1/reopen');
  });

  it('writes Status by moving the task to the named section', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: [sectionNode({ id: 'S2', name: 'Done' })] },
      { status: 200, json: {} },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'Status',
        value: 'Done',
      }),
    );

    expect(transport.calls[1]!.path).toBe('/tasks/T1/move');
    expect(transport.calls[1]!.body).toBe(JSON.stringify({ section_id: 'S2' }));
  });

  it('creates a missing section before moving the task', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: [] },
      { status: 200, json: sectionNode({ id: 'S9', name: 'Shipped' }) },
      { status: 200, json: {} },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'Status',
        value: 'Shipped',
      }),
    );

    expect(transport.calls[1]!.path).toBe('/sections');
    expect(transport.calls[1]!.body).toBe(
      JSON.stringify({ name: 'Shipped', project_id: 'P1' }),
    );
    expect(transport.calls[2]!.body).toBe(JSON.stringify({ section_id: 'S9' }));
  });

  it('writes subtasks as the parent relation', async () => {
    const { adapter, transport } = adapterWith([{ status: 200, json: {} }]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'subtasks',
        value: 'T0',
      }),
    );

    expect(transport.calls[0]!.path).toBe('/tasks/T1/move');
    expect(transport.calls[0]!.body).toBe(JSON.stringify({ parent_id: 'T0' }));
  });

  it('writes the label set onto the task', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: [] },
      { status: 200, json: {} },
      { status: 200, json: taskNode() },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'label',
        value: '["type: task","bug"]',
      }),
    );

    const write = transport.calls.find((call) => call.path === '/tasks/T1')!;
    expect(write.body).toBe(
      JSON.stringify({ labels: ['type: task', 'bug'] }),
    );
  });
});

describe('TodoistMirrorAdapter — the remaining surface', () => {
  it('deletes the task', async () => {
    const { adapter, transport } = adapterWith([{ status: 204, json: null }]);

    await adapter.deleteTask('T1');

    expect(transport.calls[0]).toEqual({
      method: 'DELETE',
      path: '/tasks/T1',
      body: '',
    });
  });

  it('reads only type-labelled tasks for the project (LBL-4)', async () => {
    const { adapter } = adapterWith([
      { status: 200, json: [sectionNode()] },
      {
        status: 200,
        json: [taskNode(), taskNode({ id: 'T2', labels: ['bug'] })],
      },
    ]);

    const tasks = await adapter.readTasks(target());

    expect(tasks.map((task) => task.handle)).toEqual(['T1']);
  });

  it('captures every task, typed and untyped, active and completed (LBL-7)', async () => {
    const fixedNow = () => new Date('2026-10-08T12:00:00Z');
    const { adapter, transport } = adapterWith(
      [
        { status: 200, json: [sectionNode()] },
        {
          status: 200,
          json: [taskNode(), taskNode({ id: 'T2', labels: ['bug'] })],
        },
        {
          status: 200,
          json: {
            items: [
              taskNode({
                id: 'C3',
                task_id: 'T3',
                labels: [],
                checked: true,
              }),
            ],
            next_cursor: null,
          },
        },
      ],
      fixedNow,
    );

    const tasks = await adapter.capture(target());

    expect(tasks.map((task) => task.handle)).toEqual(['T1', 'T2', 'T3']);
    expect(transport.calls.map((call) => call.path)).toEqual([
      '/sections?project_id=P1',
      '/tasks?project_id=P1',
      '/tasks/completed/by_completion_date?since=1970-01-01T00%3A00%3A00Z&until=2026-10-08T12%3A00%3A00.000Z&project_id=P1',
    ]);
  });

  it('returns the decisive per-field time', async () => {
    const { adapter } = adapterWith([{ status: 200, json: taskNode() }]);
    const title = await adapter.fieldTime('T1', 'title');

    const { adapter: second } = adapterWith([
      {
        status: 200,
        json: taskNode({ completed_at: '2026-09-24T11:00:00Z' }),
      },
    ]);
    const completion = await second.fieldTime('T1', 'completion');

    expect(title).toBe('2026-09-18T10:00:00Z');
    expect(completion).toBe('2026-09-24T11:00:00Z');
  });

  it('reports the fetch as complete', () => {
    const { adapter } = adapterWith([]);

    expect(adapter.fetchComplete()).toBe(true);
  });

  it('reads and archives the project', async () => {
    const { adapter, transport } = adapterWith([
      {
        status: 200,
        json: { id: 'P1', name: 'Widgets', is_archived: true },
      },
      { status: 204, json: null },
    ]);

    const project = await adapter.readProject(target());
    await adapter.setArchived(target(), true);

    expect(project!.handle).toBe('P1');
    expect(project!.name).toBe('Widgets');
    expect(project!.archived).toBe(true);
    expect(transport.calls[1]!.path).toBe('/projects/P1/archive');
  });

  it('renames the project', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: { id: 'P1', name: 'New Name' } },
    ]);

    await adapter.renameProject(target(), 'New Name');

    expect(transport.calls[0]).toEqual({
      method: 'POST',
      path: '/projects/P1',
      body: JSON.stringify({ name: 'New Name' }),
    });
  });
});

const ENTITY = 'Projecten/Acme/taken/fix-the-bug.md';

class FieldVault extends FakeVaultBase {
  readonly values = new Map<string, string | null>();
  readonly applied: CanonicalFieldWrite[] = [];

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return [
      new ConnectionDataTransferObject({
        slug: 'todoist',
        application: 'todoist',
        target: target(),
      }),
    ];
  }

  override async listEntities(): Promise<readonly string[]> {
    return [ENTITY];
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

  override async applyField(write: CanonicalFieldWrite): Promise<void> {
    this.applied.push(write);
  }

  override async trashNote(): Promise<void> {}
}

class RoutingTransport implements TodoistTransport {
  readonly calls: RecordedCall[] = [];

  async get(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'GET', path, body: '' });
    if (path === '/tasks/T1') {
      return { status: 200, json: taskNode() };
    }
    if (path.startsWith('/sections?')) {
      return {
        status: 200,
        json: [sectionNode(), sectionNode({ id: 'S2', name: 'Done' })],
      };
    }
    throw new Error(`unexpected GET ${path}`);
  }

  async post(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'POST', path, body });
    if (path === '/tasks/T1/move') {
      return { status: 200, json: {} };
    }
    throw new Error(`unexpected POST ${path}`);
  }

  async delete(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'DELETE', path, body: '' });
    throw new Error(`unexpected DELETE ${path}`);
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

describe('MirrorSyncAction drives the task manager through the ports (F02 NWM-3)', () => {
  it('reconciles a vault Status change onto the named section', async () => {
    const transport = new RoutingTransport();
    const adapter = new TodoistMirrorAdapter(transport, target());

    const vault = new FieldVault();
    vault.values.set('title', 'Fix the bug');
    vault.values.set('body', 'The bug happens on resize.');
    vault.values.set('completion', 'false');
    vault.values.set('Status', 'Done');
    vault.values.set('label', '["type: task"]');
    const registry = new SyncStateAdapter(memoryStorage());
    await registry.setEntity({ id: ENTITY, notePath: ENTITY });
    await registry.setMirrorItem('Acme', 'todoist', 'T1', { entityId: ENTITY });
    for (const field of ['title', 'body', 'completion', 'label'] as const) {
      const value = vault.values.get(field)!;
      await registry.writeBaseline(
        ENTITY,
        field,
        'origin',
        new Baseline(value, false),
      );
      await registry.writeBaseline(
        ENTITY,
        field,
        'mirror:todoist',
        new Baseline(value, false),
      );
    }
    await registry.writeBaseline(
      ENTITY,
      'Status',
      'origin',
      new Baseline('Building', false),
    );
    await registry.writeBaseline(
      ENTITY,
      'Status',
      'mirror:todoist',
      new Baseline('Building', false),
    );
    const action = new MirrorSyncAction(vault, registry, {
      create: () => adapter,
    });

    const records = await action.invoke('Acme');
    const status = records.find((record) => record.field === 'Status')!;

    expect(status.result.value).toBe('Done');
    expect(status.written).toEqual(['mirror:todoist']);
    expect(
      transport.calls.some(
        (call) =>
          call.path === '/tasks/T1/move' &&
          call.body === JSON.stringify({ section_id: 'S2' }),
      ),
    ).toBe(true);
  });
});

describe('TodoistMirrorAdapter — createTask', () => {
  // A routing fake, not the positional queue: deleting the create-path
  // provisioning must redden the sequence assertion below on its own terms,
  // rather than only shifting the queue into an unrelated shape error.
  class CreateTransport implements TodoistTransport {
    readonly calls: RecordedCall[] = [];

    async get(path: string): Promise<{ status: number; json: unknown }> {
      this.calls.push({ method: 'GET', path, body: '' });
      if (path.startsWith('/sections?')) {
        return {
          status: 200,
          json: [sectionNode({ id: 'S1', name: 'Building' })],
        };
      }
      if (path === '/labels') {
        return { status: 200, json: [] };
      }
      throw new Error(`unexpected GET ${path}`);
    }

    async post(
      path: string,
      body: string,
    ): Promise<{ status: number; json: unknown }> {
      this.calls.push({ method: 'POST', path, body });
      if (path === '/labels') {
        return { status: 200, json: {} };
      }
      if (path === '/tasks') {
        return {
          status: 200,
          json: taskNode({
            id: 'T9',
            content: 'New task',
            description: 'Body',
          }),
        };
      }
      throw new Error(`unexpected POST ${path}`);
    }

    async delete(path: string): Promise<{ status: number; json: unknown }> {
      this.calls.push({ method: 'DELETE', path, body: '' });
      throw new Error(`unexpected DELETE ${path}`);
    }
  }

  it('creates a task in its section and returns the canonical task', async () => {
    const transport = new CreateTransport();
    const adapter = new TodoistMirrorAdapter(transport, target());

    const created = await adapter.createTask(
      target(),
      new CanonicalTask({
        handle: '',
        entityId: 'uuid-1',
        title: 'New task',
        body: 'Body',
        status: 'Building',
        completed: false,
        parent: null,
        labels: ['type: task'],
      }),
    );

    const create = transport.calls.find((call) => call.path === '/tasks')!;
    expect(create.body).toBe(
      JSON.stringify({
        content: 'New task',
        description: 'Body',
        project_id: 'P1',
        labels: ['type: task'],
        section_id: 'S1',
      }),
    );

    // LBL-14 — the create path provisions the kind label too, before the task
    // body goes out: the account's labels are looked up (`GET /labels`) and the
    // absent kind label created (`POST /labels`). Removing the ensure from
    // `createTask` leaves only the sections read and the task write, so this
    // sequence assertion reddens.
    expect(
      transport.calls.map((call) => `${call.method} ${call.path}`),
    ).toEqual([
      'GET /sections?project_id=P1',
      'GET /labels',
      'POST /labels',
      'POST /tasks',
    ]);
    expect(JSON.parse(transport.calls[2]!.body)).toMatchObject({
      name: 'type: task',
      color: 'lime_green',
    });
    expect(created.handle).toBe('T9');
    expect(created.entityId).toBe('uuid-1');
  });
});

// LBL-10 — the label crosses every boundary verbatim. No adapter translates,
// strips or re-renders the prefix; the vault's own string goes out untouched.
// The sequence mixes the canonical unspaced kind, a spaced kind and a non-kind
// `type:`-prefixed label so any future normalisation at the boundary reddens.
describe('LBL-10 — the label crosses to the task manager verbatim', () => {
  it('writes the vault label sequence unmodified, with no translation', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: [] },
      { status: 200, json: {} },
      { status: 200, json: [] },
      { status: 200, json: {} },
      { status: 200, json: taskNode() },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'label',
        value: '["type:bug","type: slice","type:something","priority:high"]',
      }),
    );

    const write = transport.calls.find((call) => call.path === '/tasks/T1')!;
    expect(write.body).toBe(
      JSON.stringify({
        labels: ['type:bug', 'type: slice', 'type:something', 'priority:high'],
      }),
    );
  });
});

// S29 — LBL-14 (provision and recolour before applying) and LBL-15 (the kind
// palette). These pin the requests the adapter makes, as the suite does
// elsewhere: the account's labels are looked up (`GET /labels`) first, a create
// (`POST /labels`) or recolour (`POST /labels/{id}`) follows only when the
// lookup says it is needed, and the label write lands last.
//
// Gaps the spec leaves undetermined; these tests assume the obvious reading and
// must be revisited when the implementation pins them:
//   - the wire field that marks a label as collaborator-owned / shared. Verified
//     against the Todoist API v1 reference the adapter's BASE_URL follows
//     (developer.todoist.com/api/v1): a label from `GET /labels` is
//     `LabelRestView` — `id`, `name`, `color`, `order`, `is_favorite` only, with
//     no `is_shared` (`is_shared` is a *project* field: "Whether the project is
//     shared with other users"). Shared labels are a separate endpoint,
//     `GET /labels/shared`, which returns names (`PaginatedList[str]`), not a
//     per-label ownership flag. The fixtures' `is_shared: true` therefore
//     mirrors the implementation's guess, not the wire; the shared-label no-op
//     is not reachable from the documented `GET /labels` response.
//   - the create body beyond `name` and `color` is not pinned, so the create
//     assertion matches those two fields rather than the whole body.
//   - the update body is only required to carry the palette colour.
describe('TodoistMirrorAdapter — label provisioning (LBL-14, LBL-15)', () => {
  const kindLabel = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 'L1',
    name: 'type:task',
    color: 'lime_green',
    ...overrides,
  });

  it('creates an absent kind label as personal at the palette colour, then applies it (LBL-14)', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: [] },
      { status: 200, json: kindLabel({ id: 'L9' }) },
      { status: 200, json: taskNode() },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'label',
        value: '["type:task"]',
      }),
    );

    expect(
      transport.calls.map((call) => `${call.method} ${call.path}`),
    ).toEqual(['GET /labels', 'POST /labels', 'POST /tasks/T1']);
    expect(JSON.parse(transport.calls[1]!.body)).toMatchObject({
      name: 'type:task',
      color: 'lime_green',
    });
  });

  it('does not recreate a kind label that already exists (LBL-14)', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: [kindLabel()] },
      { status: 200, json: taskNode() },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'label',
        value: '["type:task"]',
      }),
    );

    expect(
      transport.calls.filter(
        (call) => call.method === 'POST' && call.path === '/labels',
      ),
    ).toEqual([]);
    expect(transport.calls[0]).toEqual({
      method: 'GET',
      path: '/labels',
      body: '',
    });
    expect(transport.calls.at(-1)!.path).toBe('/tasks/T1');
  });

  it('recolours an existing off-palette kind label to the palette colour (LBL-14, LBL-15)', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: [kindLabel({ color: 'charcoal' })] },
      { status: 200, json: [] },
      { status: 200, json: kindLabel() },
      { status: 200, json: taskNode() },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'label',
        value: '["type:task"]',
      }),
    );

    expect(
      transport.calls.map((call) => `${call.method} ${call.path}`),
    ).toEqual([
      'GET /labels',
      'GET /labels/shared',
      'POST /labels/L1',
      'POST /tasks/T1',
    ]);
    expect(JSON.parse(transport.calls[2]!.body)).toMatchObject({
      color: 'lime_green',
    });
  });

  it('makes no create or update when the kind label is already the palette colour (LBL-14)', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: [kindLabel()] },
      { status: 200, json: taskNode() },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'label',
        value: '["type:task"]',
      }),
    );

    expect(
      transport.calls.map((call) => `${call.method} ${call.path}`),
    ).toEqual(['GET /labels', 'POST /tasks/T1']);
  });

  it('skips the recolour of a collaborator-owned shared label and still writes it (LBL-14)', async () => {
    // The shared signal is the label's name appearing in the account's shared
    // collection (`GET /labels/shared`), not a per-label ownership field: a
    // label from `GET /labels` is `id, name, color, order, is_favorite` only.
    const { adapter, transport } = adapterWith([
      { status: 200, json: [kindLabel({ id: 'L7', color: 'charcoal' })] },
      { status: 200, json: ['type:task'] },
      { status: 200, json: taskNode() },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'label',
        value: '["type:task"]',
      }),
    );

    expect(
      transport.calls.filter(
        (call) => call.method === 'POST' && call.path === '/labels/L7',
      ),
    ).toEqual([]);
    expect(
      transport.calls.map((call) => `${call.method} ${call.path}`),
    ).toEqual(['GET /labels', 'GET /labels/shared', 'POST /tasks/T1']);
    expect(transport.calls.at(-1)!.body).toBe(
      JSON.stringify({ labels: ['type:task'] }),
    );
  });

  it('recolours an off-palette kind label that is not shared (LBL-14, LBL-15)', async () => {
    // The same shape as the shared case, but the shared collection omits the
    // label: the recolour must happen. The two branches are told apart by the
    // real signal (`GET /labels/shared`), not by a per-label guess.
    const { adapter, transport } = adapterWith([
      { status: 200, json: [kindLabel({ id: 'L1', color: 'charcoal' })] },
      { status: 200, json: [] },
      { status: 200, json: kindLabel() },
      { status: 200, json: taskNode() },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'label',
        value: '["type:task"]',
      }),
    );

    expect(
      transport.calls.map((call) => `${call.method} ${call.path}`),
    ).toEqual([
      'GET /labels',
      'GET /labels/shared',
      'POST /labels/L1',
      'POST /tasks/T1',
    ]);
    expect(JSON.parse(transport.calls[2]!.body)).toMatchObject({
      color: 'lime_green',
    });
  });

  const KIND_PALETTE: Array<[kind: string, colour: string]> = [
    ['slice', 'grape'],
    ['pitch', 'orange'],
    ['task', 'lime_green'],
    ['bug', 'berry_red'],
    ['chore', 'light_blue'],
    ['todo', 'yellow'],
  ];

  it.each(KIND_PALETTE)(
    'creates the %s kind label at the %s palette colour (LBL-15)',
    async (kind, colour) => {
      const { adapter, transport } = adapterWith([
        { status: 200, json: [] },
        {
          status: 200,
          json: { id: 'L9', name: `type:${kind}`, color: colour },
        },
        { status: 200, json: taskNode() },
      ]);

      await adapter.applyField(
        new CanonicalFieldWrite({
          handle: 'T1',
          field: 'label',
          value: JSON.stringify([`type:${kind}`]),
        }),
      );

      const create = transport.calls.find(
        (call) => call.method === 'POST' && call.path === '/labels',
      );
      expect(create).toBeDefined();
      expect(JSON.parse(create!.body)).toMatchObject({
        name: `type:${kind}`,
        color: colour,
      });
    },
  );
});
