import { describe, expect, it, vi } from 'vitest';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl }));

import {
  TodoistAdapter,
  createTodoistTransport,
  type TodoistTransport,
} from '../../src/todoist/TodoistAdapter.js';
import type { CreateTodoistTaskData } from '../../src/todoist/CreateTodoistTaskData.js';

function fakeTransport(responses: Array<{ status: number; json: unknown }>) {
  const calls: Array<{ method: string; path: string; body: string }> = [];
  const next = () => {
    const response = responses.shift();
    if (!response) {
      throw new Error('fake transport: no more responses queued');
    }
    return response;
  };
  const transport: TodoistTransport = {
    async get(path) {
      calls.push({ method: 'GET', path, body: '' });
      return next();
    },
    async post(path, body) {
      calls.push({ method: 'POST', path, body });
      return next();
    },
    async delete(path) {
      calls.push({ method: 'DELETE', path, body: '' });
      return next();
    },
  };
  return { transport, calls };
}

const fixedNow = () => new Date('2026-09-24T12:00:00.000Z');

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: 'P1',
    name: 'Widgets',
    is_archived: false,
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function section(overrides: Record<string, unknown> = {}) {
  return { id: 'S1', project_id: 'P1', name: 'Unshaped', ...overrides };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'T1',
    project_id: 'P1',
    section_id: 'S1',
    parent_id: null,
    content: 'Fix the widget',
    labels: ['task'],
    checked: false,
    added_at: '2026-09-18T09:00:00Z',
    updated_at: '2026-09-18T10:00:00Z',
    ...overrides,
  };
}

describe('PRJ-2 — Todoist projects are fetched and mapped canonically', () => {
  it('maps an active and an archived project, creation clock included', async () => {
    const { transport, calls } = fakeTransport([
      {
        status: 200,
        json: {
          results: [
            project(),
            project({ id: 'P2', name: 'Old', is_archived: true }),
          ],
          next_cursor: null,
        },
      },
    ]);
    const adapter = new TodoistAdapter(transport);

    const result = await adapter.fetchProjects();

    expect(result).toEqual([
      {
        id: 'P1',
        name: 'Widgets',
        isArchived: false,
        createdAt: '2026-09-01T00:00:00Z',
      },
      {
        id: 'P2',
        name: 'Old',
        isArchived: true,
        createdAt: '2026-09-01T00:00:00Z',
      },
    ]);
    expect(calls[0]).toEqual({ method: 'GET', path: '/projects', body: '' });
  });

  it('walks every page of a cursor-paginated list', async () => {
    const { transport, calls } = fakeTransport([
      { status: 200, json: { results: [project()], next_cursor: 'abc' } },
      {
        status: 200,
        json: { results: [project({ id: 'P2' })], next_cursor: null },
      },
    ]);
    const adapter = new TodoistAdapter(transport);

    const result = await adapter.fetchProjects();

    expect(result.map((p) => p.id)).toEqual(['P1', 'P2']);
    expect(calls[1]!.path).toBe('/projects?cursor=abc');
  });

  it('fetches one project by id, archived state included', async () => {
    const { transport, calls } = fakeTransport([
      { status: 200, json: project({ id: 'P2', is_archived: true }) },
    ]);
    const adapter = new TodoistAdapter(transport);

    const result = await adapter.fetchProject('P2');

    expect(result).toEqual({
      id: 'P2',
      name: 'Widgets',
      isArchived: true,
      createdAt: '2026-09-01T00:00:00Z',
    });
    expect(calls[0]).toEqual({ method: 'GET', path: '/projects/P2', body: '' });
  });

  it('returns null when a project no longer exists', async () => {
    const { transport } = fakeTransport([{ status: 404, json: null }]);
    const adapter = new TodoistAdapter(transport);

    expect(await adapter.fetchProject('P-gone')).toBeNull();
  });
});

describe('PRJ-1 — a vault-born project is created in Todoist', () => {
  it('creates the project and maps the created record', async () => {
    const { transport, calls } = fakeTransport([
      { status: 200, json: project({ id: 'P9', name: 'Fresh' }) },
    ]);
    const adapter = new TodoistAdapter(transport);

    const result = await adapter.createProject('Fresh');

    expect(result).toEqual({
      id: 'P9',
      name: 'Fresh',
      isArchived: false,
      createdAt: '2026-09-01T00:00:00Z',
    });
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/projects',
      body: JSON.stringify({ name: 'Fresh' }),
    });
  });

  it('renames the project via the update endpoint', async () => {
    const { transport, calls } = fakeTransport([{ status: 200, json: {} }]);
    const adapter = new TodoistAdapter(transport);

    await adapter.updateProject('P1', 'Renamed');

    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/projects/P1',
      body: JSON.stringify({ name: 'Renamed' }),
    });
  });
});

describe('ARC-1/ARC-3 — archiving and unarchiving a project', () => {
  it('targets the archive endpoint in both directions', async () => {
    for (const { archived, endpoint } of [
      { archived: true, endpoint: 'archive' },
      { archived: false, endpoint: 'unarchive' },
    ]) {
      const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
      const adapter = new TodoistAdapter(transport);

      await adapter.setProjectArchived('P1', archived);

      expect(calls[0], `archived=${archived}`).toEqual({
        method: 'POST',
        path: `/projects/P1/${endpoint}`,
        body: '',
      });
    }
  });
});

describe('LANE-1/LANE-3 — Todoist sections are the board lanes', () => {
  it('fetches a project’s sections and maps them', async () => {
    const { transport, calls } = fakeTransport([
      { status: 200, json: { results: [section()], next_cursor: null } },
    ]);
    const adapter = new TodoistAdapter(transport);

    const result = await adapter.fetchSections('P1');

    expect(result).toEqual([{ id: 'S1', projectId: 'P1', name: 'Unshaped' }]);
    expect(calls[0]!.path).toBe('/sections?project_id=P1');
  });

  it('creates a section scoped to its project', async () => {
    const { transport, calls } = fakeTransport([
      { status: 200, json: section({ id: 'S2', name: 'Building' }) },
    ]);
    const adapter = new TodoistAdapter(transport);

    const result = await adapter.createSection('P1', 'Building');

    expect(result).toEqual({ id: 'S2', projectId: 'P1', name: 'Building' });
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/sections',
      body: JSON.stringify({ name: 'Building', project_id: 'P1' }),
    });
  });

  it('renames a section in place', async () => {
    const { transport, calls } = fakeTransport([
      { status: 200, json: section({ id: 'S1', name: 'Backlog' }) },
    ]);
    const adapter = new TodoistAdapter(transport);

    await adapter.updateSection('S1', 'Backlog');

    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/sections/S1',
      body: JSON.stringify({ name: 'Backlog' }),
    });
  });
});

describe('MAT-4/COM-3 — Todoist tasks are read into the vault', () => {
  it('maps active tasks with section, parent and labels preserved', async () => {
    const { transport, calls } = fakeTransport([
      {
        status: 200,
        json: {
          results: [
            task(),
            task({
              id: 'T2',
              section_id: null,
              parent_id: 'T1',
              content: 'A to-do',
              labels: ['todo'],
            }),
          ],
          next_cursor: null,
        },
      },
    ]);
    const adapter = new TodoistAdapter(transport);

    const result = await adapter.fetchActiveTasks('P1');

    expect(result).toEqual([
      {
        id: 'T1',
        projectId: 'P1',
        sectionId: 'S1',
        parentId: null,
        content: 'Fix the widget',
        labels: ['task'],
        isCompleted: false,
        addedAt: '2026-09-18T09:00:00Z',
        updatedAt: '2026-09-18T10:00:00Z',
        completedAt: null,
      },
      {
        id: 'T2',
        projectId: 'P1',
        sectionId: null,
        parentId: 'T1',
        content: 'A to-do',
        labels: ['todo'],
        isCompleted: false,
        addedAt: '2026-09-18T09:00:00Z',
        updatedAt: '2026-09-18T10:00:00Z',
        completedAt: null,
      },
    ]);
    expect(calls[0]!.path).toBe('/tasks?project_id=P1');
  });

  it('queries completed tasks by completion date within the clock window', async () => {
    const { transport, calls } = fakeTransport([
      {
        status: 200,
        json: {
          items: [
            {
              id: 'C1',
              task_id: 'T1',
              project_id: 'P1',
              section_id: 'S1',
              parent_id: null,
              content: 'Fix the widget',
              labels: ['task'],
              completed_at: '2026-09-24T11:00:00Z',
            },
          ],
          next_cursor: null,
        },
      },
    ]);
    const adapter = new TodoistAdapter(transport, fixedNow);

    const result = await adapter.fetchCompletedTasks(
      'P1',
      '2026-09-24T10:00:00Z',
    );

    expect(result).toEqual([
      {
        id: 'T1',
        projectId: 'P1',
        sectionId: 'S1',
        parentId: null,
        content: 'Fix the widget',
        labels: ['task'],
        isCompleted: true,
        addedAt: '',
        updatedAt: '',
        completedAt: '2026-09-24T11:00:00Z',
      },
    ]);
    expect(calls[0]!.path).toBe(
      '/tasks/completed/by_completion_date?since=2026-09-24T10%3A00%3A00Z&until=2026-09-24T12%3A00%3A00.000Z&project_id=P1',
    );
  });
});

describe('MAT-1 — a vault-born task is created in Todoist', () => {
  it('sends the placement and labels it is given, and omits the rest', async () => {
    const cases: Array<{
      input: CreateTodoistTaskData;
      body: Record<string, unknown>;
    }> = [
      {
        input: {
          projectId: 'P1',
          sectionId: 'S1',
          content: 'New',
          labels: ['task'],
        },
        body: {
          content: 'New',
          project_id: 'P1',
          section_id: 'S1',
          labels: ['task'],
        },
      },
      {
        input: { projectId: 'P1', content: 'Bare' },
        body: { content: 'Bare', project_id: 'P1' },
      },
    ];
    for (const { input, body } of cases) {
      const { transport, calls } = fakeTransport([
        { status: 200, json: task({ id: 'T9', content: input.content }) },
      ]);
      const adapter = new TodoistAdapter(transport);

      const result = await adapter.createTask(input);

      expect(result.id, input.content).toBe('T9');
      expect(calls[0]!.body, input.content).toBe(JSON.stringify(body));
    }
  });

  it('updates a task’s content and labels', async () => {
    const { transport, calls } = fakeTransport([{ status: 200, json: {} }]);
    const adapter = new TodoistAdapter(transport);

    await adapter.updateTask('T1', { content: 'Renamed', labels: ['bug'] });

    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/tasks/T1',
      body: JSON.stringify({ content: 'Renamed', labels: ['bug'] }),
    });
  });
});

describe('TODO-1/SUB-2/SLI-2 — moving a twin into its lane or under its parent', () => {
  it('sends exactly the destination fields a move is given', async () => {
    const cases: Array<{
      to: { sectionId?: string; parentId?: string | null };
      body: Record<string, unknown>;
    }> = [
      { to: { sectionId: 'S2' }, body: { section_id: 'S2' } },
      { to: { parentId: 'T1' }, body: { parent_id: 'T1' } },
      { to: { parentId: null }, body: { parent_id: null } },
      {
        to: { sectionId: 'S2', parentId: null },
        body: { parent_id: null, section_id: 'S2' },
      },
    ];
    for (const { to, body } of cases) {
      const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
      const adapter = new TodoistAdapter(transport);

      await adapter.moveTask('T1', to);

      expect(calls[0], JSON.stringify(to)).toEqual({
        method: 'POST',
        path: '/tasks/T1/move',
        body: JSON.stringify(body),
      });
    }
  });

  it('refuses a move with neither or both destinations before any request', async () => {
    for (const to of [{}, { sectionId: 'S2', parentId: 'T1' }]) {
      const { transport, calls } = fakeTransport([]);
      const adapter = new TodoistAdapter(transport);

      await expect(adapter.moveTask('T1', to)).rejects.toThrow(/exactly one/);
      expect(calls, JSON.stringify(to)).toHaveLength(0);
    }
  });
});

describe('COM-1/COM-3 — completing and reopening a twin', () => {
  it('targets the close or reopen endpoint to match the flag', async () => {
    for (const { completed, endpoint } of [
      { completed: true, endpoint: 'close' },
      { completed: false, endpoint: 'reopen' },
    ]) {
      const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
      const adapter = new TodoistAdapter(transport);

      await adapter.setTaskCompleted('T1', completed);

      expect(calls[0]!.path, `completed=${completed}`).toBe(
        `/tasks/T1/${endpoint}`,
      );
    }
  });
});

describe('DEL-1/DEL-2 — deleting a twin', () => {
  it('deletes a task, and treats an already-gone task as a no-op', async () => {
    for (const { id, status } of [
      { id: 'T1', status: 204 },
      { id: 'T-gone', status: 404 },
    ]) {
      const { transport, calls } = fakeTransport([{ status, json: null }]);
      const adapter = new TodoistAdapter(transport);

      await expect(adapter.deleteTask(id)).resolves.toBeUndefined();
      expect(calls[0]).toEqual({
        method: 'DELETE',
        path: `/tasks/${id}`,
        body: '',
      });
    }
  });
});

describe('LANE-1 — the label vocabulary is ensured on demand', () => {
  it('lists, then creates only the missing label', async () => {
    const { transport, calls } = fakeTransport([
      {
        status: 200,
        json: { results: [{ id: 'L1', name: 'task' }], next_cursor: null },
      },
      { status: 200, json: { results: [], next_cursor: null } },
      { status: 200, json: { id: 'L2', name: 'slice' } },
    ]);
    const adapter = new TodoistAdapter(transport);

    await adapter.ensureLabel('task');
    await adapter.ensureLabel('slice');

    expect(calls).toHaveLength(3);
    expect(calls[1]!.method).toBe('GET');
    expect(calls[2]).toEqual({
      method: 'POST',
      path: '/labels',
      body: JSON.stringify({ name: 'slice' }),
    });
  });
});

describe('adapter — failures surface with the status and shape', () => {
  it('throws the status on a failed request and a shape error on a bad list', async () => {
    const failed = new TodoistAdapter(
      fakeTransport([{ status: 401, json: {} }]).transport,
    );
    await expect(failed.fetchProjects()).rejects.toThrow(/status 401/);

    const shaped = new TodoistAdapter(
      fakeTransport([{ status: 200, json: { nope: true } }]).transport,
    );
    await expect(shaped.fetchProjects()).rejects.toThrow(/list response shape/);
  });
});

describe('createTodoistTransport — the live transport goes through requestUrl', () => {
  it('sends the bearer token and maps the response text to json', async () => {
    requestUrl.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ results: [] }),
      json: { results: [] },
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });
    const transport = createTodoistTransport('secret-token');

    const response = await transport.get('/projects');

    expect(requestUrl).toHaveBeenCalledWith({
      url: 'https://api.todoist.com/api/v1/projects',
      method: 'GET',
      headers: { Authorization: 'Bearer secret-token' },
      throw: false,
    });
    expect(response).toEqual({ status: 200, json: { results: [] } });
  });

  it('adds the JSON content type and body on a write, and tolerates an empty body', async () => {
    requestUrl.mockResolvedValueOnce({
      status: 204,
      text: '',
      json: null,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });
    const transport = createTodoistTransport('secret-token');

    const response = await transport.post('/tasks', '{"content":"x"}');

    expect(requestUrl).toHaveBeenCalledWith({
      url: 'https://api.todoist.com/api/v1/tasks',
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: '{"content":"x"}',
      throw: false,
    });
    expect(response).toEqual({ status: 204, json: null });
  });
});
