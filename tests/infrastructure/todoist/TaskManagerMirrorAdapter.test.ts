import { describe, expect, it } from 'vitest';
import { AdapterRegistration } from '../../../src/core/data/AdapterRegistration.js';
import { Baseline } from '../../../src/core/data/Baseline.js';
import { CanonicalFieldWrite } from '../../../src/core/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../../src/core/data/CanonicalTask.js';
import { MirrorSyncPass } from '../../../src/core/data/MirrorSyncPass.js';
import { SideObservation } from '../../../src/core/data/SideObservation.js';
import { MirrorSyncAction } from '../../../src/core/MirrorSyncAction.js';
import { registerAdapters } from '../../../src/core/registerAdapters.js';
import { TaskManagerMirrorAdapter } from '../../../src/infrastructure/todoist/TaskManagerMirrorAdapter.js';
import type { TaskManagerTransport } from '../../../src/infrastructure/todoist/TaskManagerTransport.js';
import { TaskManagerTarget } from '../../../src/infrastructure/todoist/TaskManagerTarget.js';
import { todoistDescriptor } from '../../../src/infrastructure/todoist/todoistDescriptor.js';
import { TodoistTaskMapper } from '../../../src/todoist/TodoistTaskMapper.js';
import { typeFromLabels } from '../../../src/shared/typeFromLabels.js';
import { todoistTask } from '../../helpers/records.js';

function target(): string {
  return new TaskManagerTarget({ projectId: 'P1' }).serialize();
}

interface RecordedCall {
  method: string;
  path: string;
  body: string;
}

class FakeTransport implements TaskManagerTransport {
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

function adapterWith(responses: Array<{ status: number; json: unknown }>): {
  adapter: TaskManagerMirrorAdapter;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(responses);
  return {
    adapter: new TaskManagerMirrorAdapter(transport, target()),
    transport,
  };
}

describe('TaskManagerMirrorAdapter — the canonical read (F01 ACM-5)', () => {
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
});

describe('TaskManagerMirrorAdapter — the existing half is the characterization (MAT-4)', () => {
  it('matches TodoistTaskMapper on the shared canonical fields', async () => {
    const { adapter } = adapterWith([
      { status: 200, json: taskNode() },
      { status: 200, json: [sectionNode()] },
    ]);

    const task = await adapter.readTask('T1');
    const existing = TodoistTaskMapper.parseTask(
      todoistTask({
        id: 'T1',
        sectionId: 'S1',
        content: 'Fix the bug',
        labels: ['type: task'],
        addedAt: '2026-09-18T09:00:00Z',
        updatedAt: '2026-09-18T10:00:00Z',
      }),
      { id: 'S1', projectId: 'P1', name: 'Building' },
      null,
    );

    expect(task!.title).toBe(existing.title);
    expect(task!.status).toBe(existing.status);
    expect(task!.parent).toBe(existing.parent);
    expect(typeFromLabels([...task!.labels])).toBe(existing.type);
  });
});

describe('TaskManagerMirrorAdapter — the canonical writes (F01 ACM-5)', () => {
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
      { status: 200, json: taskNode() },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: 'T1',
        field: 'label',
        value: 'type: task,bug',
      }),
    );

    expect(transport.calls[0]!.body).toBe(
      JSON.stringify({ labels: ['type: task', 'bug'] }),
    );
  });
});

describe('TaskManagerMirrorAdapter — the remaining surface', () => {
  it('deletes the task', async () => {
    const { adapter, transport } = adapterWith([{ status: 204, json: null }]);

    await adapter.deleteTask('T1');

    expect(transport.calls[0]).toEqual({
      method: 'DELETE',
      path: '/tasks/T1',
      body: '',
    });
  });

  it('reads the tracked (typed) tasks for the project', async () => {
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

  it('captures the untyped tasks as remote-born tasks', async () => {
    const { adapter } = adapterWith([
      { status: 200, json: [sectionNode()] },
      {
        status: 200,
        json: [
          taskNode(),
          taskNode({ id: 'T2', labels: ['bug'] }),
          taskNode({ id: 'T3', labels: [], checked: true }),
        ],
      },
    ]);

    const tasks = await adapter.capture(target());

    expect(tasks.map((task) => task.handle)).toEqual(['T2', 'T3']);
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
});

describe('todoistDescriptor — registers with the core (F01 ACM-8, ACM-9)', () => {
  it('registers the task manager as a mirror under the application id todoist', () => {
    const result = registerAdapters([
      new AdapterRegistration(
        todoistDescriptor(),
        new TaskManagerMirrorAdapter(new FakeTransport([]), target()),
      ),
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.adapters.get('todoist')?.descriptor.applicationId).toBe(
      'todoist',
    );
  });

  it('declares the universal and mandatory surface plus the optional mirrors', () => {
    const descriptor = todoistDescriptor();

    expect(descriptor.capabilities).toContain('project');
    expect(descriptor.capabilities).toContain('lifecycle');
    expect(descriptor.capabilities).toContain('Status');
    expect(descriptor.capabilities).toContain('label');
    expect(descriptor.capabilities).toContain('subtasks');
    expect(descriptor.capabilities).toContain('completion');
    expect(descriptor.capabilities).toContain('capture');
    expect(descriptor.capabilities).toContain(
      'trustworthy per-field timestamps',
    );
    expect(descriptor.capabilities).toContain('complete-fetch');
    expect(descriptor.represents('Status')).toBe(true);
    expect(descriptor.represents('subtasks')).toBe(true);
  });
});

describe('MirrorSyncAction drives the task manager through the ports (F02 NWM-3)', () => {
  it('reconciles a vault Status change onto the named section', async () => {
    const transport = new FakeTransport([
      { status: 200, json: taskNode() },
      { status: 200, json: [sectionNode()] },
      { status: 200, json: taskNode() },
      { status: 200, json: taskNode() },
      { status: 200, json: [sectionNode()] },
      { status: 200, json: [sectionNode({ id: 'S2', name: 'Done' })] },
      { status: 200, json: {} },
    ]);
    const adapter = new TaskManagerMirrorAdapter(transport, target());
    const registered = registerAdapters([
      new AdapterRegistration(todoistDescriptor(), adapter),
    ]).adapters.get('todoist')!;

    const pass = new MirrorSyncPass({
      entityId: 'T1',
      field: 'Status',
      origin: new SideObservation({
        side: 'vault',
        role: 'origin',
        current: 'Done',
        baseline: new Baseline('Building', false),
        fieldTime: null,
        timestampTrustworthy: true,
        completeFetch: true,
        currentCompleted: false,
      }),
      mirrors: [registered],
      baselines: new Map([['todoist', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction().invoke(pass);

    expect(record.result.value).toBe('Done');
    expect(record.written).toEqual(['todoist']);
    expect(transport.calls[6]!.path).toBe('/tasks/T1/move');
    expect(transport.calls[6]!.body).toBe(JSON.stringify({ section_id: 'S2' }));
  });
});

describe('TaskManagerMirrorAdapter — createTask', () => {
  it('creates a task in its section and returns the canonical task', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: [sectionNode({ id: 'S1', name: 'Building' })] },
      {
        status: 200,
        json: taskNode({ id: 'T9', content: 'New task', description: 'Body' }),
      },
    ]);

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

    expect(transport.calls[1]!.path).toBe('/tasks');
    expect(transport.calls[1]!.body).toBe(
      JSON.stringify({
        content: 'New task',
        description: 'Body',
        project_id: 'P1',
        labels: ['type: task'],
        section_id: 'S1',
      }),
    );
    expect(created.handle).toBe('T9');
    expect(created.entityId).toBe('uuid-1');
  });
});
