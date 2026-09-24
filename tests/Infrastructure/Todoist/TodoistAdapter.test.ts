import { describe, expect, it } from 'vitest';
import {
  TodoistAdapter,
  type TodoistTransport,
} from '../../../src/Infrastructure/Todoist/TodoistAdapter.js';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';

// A fake transport at the boundary: returns canned responses in call order
// and records the method/path/body, so the adapter's mapping and request
// shaping are what's under test — never a real Todoist call.
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

// A fixed clock so the completed-since query's `until` bound is deterministic.
const fixedNow = () => new Date('2026-09-24T12:00:00.000Z');

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: 'P1',
    name: 'Widgets',
    is_archived: false,
    ...overrides,
  };
}

function section(overrides: Record<string, unknown> = {}) {
  return {
    id: 'S1',
    project_id: 'P1',
    name: 'Unshaped',
    ...overrides,
  };
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
    ...overrides,
  };
}

describe('TodoistAdapter', () => {
  it('fetches projects and maps them onto the DTO', async () => {
    // Given — a list response carrying an active and an archived project
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

    // When — the adapter fetches the projects
    const result = await adapter.fetchProjects();

    // Then — both are mapped, archived state included
    expect(result).toEqual([
      { id: 'P1', name: 'Widgets', isArchived: false },
      { id: 'P2', name: 'Old', isArchived: true },
    ]);
    // And the GET targeted the projects endpoint
    expect(calls[0]).toEqual({ method: 'GET', path: '/projects', body: '' });
  });

  it('walks every page of a cursor-paginated list', async () => {
    // Given — a first page with a next cursor and a short second page
    const { transport, calls } = fakeTransport([
      { status: 200, json: { results: [project()], next_cursor: 'abc' } },
      {
        status: 200,
        json: { results: [project({ id: 'P2' })], next_cursor: null },
      },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter fetches the projects
    const result = await adapter.fetchProjects();

    // Then — both pages are concatenated in order
    expect(result.map((p) => p.id)).toEqual(['P1', 'P2']);
    // And the second request carried the cursor
    expect(calls[1]!.path).toBe('/projects?cursor=abc');
  });

  it('fetches a single project by id, archived state included', async () => {
    // Given — a single-project response for an archived project
    const { transport, calls } = fakeTransport([
      { status: 200, json: project({ id: 'P2', is_archived: true }) },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter fetches the project by id
    const result = await adapter.fetchProject('P2');

    // Then — the archived project is mapped
    expect(result).toEqual({ id: 'P2', name: 'Widgets', isArchived: true });
    // And the GET targeted the project
    expect(calls[0]).toEqual({ method: 'GET', path: '/projects/P2', body: '' });
  });

  it('returns null when a project no longer exists', async () => {
    // Given — a 404 for a deleted project
    const { transport } = fakeTransport([{ status: 404, json: null }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter fetches the missing project
    const result = await adapter.fetchProject('P-gone');

    // Then — null is returned, so the caller can re-resolve by name
    expect(result).toBeNull();
  });

  it('creates a project and maps the created record', async () => {
    // Given — a create response
    const { transport, calls } = fakeTransport([
      { status: 200, json: project({ id: 'P9', name: 'Fresh' }) },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter creates the project
    const result = await adapter.createProject('Fresh');

    // Then — the created project is mapped
    expect(result).toEqual({ id: 'P9', name: 'Fresh', isArchived: false });
    // And the POST carried the name
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/projects',
      body: JSON.stringify({ name: 'Fresh' }),
    });
  });

  it('renames a project via the update endpoint', async () => {
    // Given — an accepted update
    const { transport, calls } = fakeTransport([{ status: 200, json: {} }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter renames the project
    await adapter.updateProject('P1', 'Renamed');

    // Then — the POST targeted the project with the new name
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/projects/P1',
      body: JSON.stringify({ name: 'Renamed' }),
    });
  });

  it('archives a project via the archive endpoint', async () => {
    // Given — an accepted archive
    const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter archives the project
    await adapter.setProjectArchived('P1', true);

    // Then — the POST targeted the archive endpoint
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/projects/P1/archive',
      body: '',
    });
  });

  it('unarchives a project via the unarchive endpoint', async () => {
    // Given — an accepted unarchive
    const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter unarchives the project
    await adapter.setProjectArchived('P1', false);

    // Then — the POST targeted the unarchive endpoint
    expect(calls[0]!.path).toBe('/projects/P1/unarchive');
  });

  it('fetches a project’s sections and maps them onto the DTO', async () => {
    // Given — a sections list response
    const { transport, calls } = fakeTransport([
      { status: 200, json: { results: [section()], next_cursor: null } },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter fetches the sections
    const result = await adapter.fetchSections('P1');

    // Then — the section is mapped
    expect(result).toEqual([{ id: 'S1', projectId: 'P1', name: 'Unshaped' }]);
    // And the GET scoped to the project
    expect(calls[0]!.path).toBe('/sections?project_id=P1');
  });

  it('creates a section scoped to its project', async () => {
    // Given — a create response
    const { transport, calls } = fakeTransport([
      { status: 200, json: section({ id: 'S2', name: 'Building' }) },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter creates the section
    const result = await adapter.createSection('P1', 'Building');

    // Then — the created section is mapped
    expect(result).toEqual({ id: 'S2', projectId: 'P1', name: 'Building' });
    // And the POST carried the name and project
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/sections',
      body: JSON.stringify({ name: 'Building', project_id: 'P1' }),
    });
  });

  it('renames a section in place', async () => {
    // Given — an update response
    const { transport, calls } = fakeTransport([
      { status: 200, json: section({ id: 'S1', name: 'Backlog' }) },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter renames the section
    await adapter.updateSection('S1', 'Backlog');

    // Then — the POST targeted the section with the new name
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/sections/S1',
      body: JSON.stringify({ name: 'Backlog' }),
    });
  });

  it('fetches active tasks and maps section, parent and labels', async () => {
    // Given — an active task list with a top-level and a nested task
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

    // When — the adapter fetches the active tasks
    const result = await adapter.fetchActiveTasks('P1');

    // Then — both are mapped, with null section/parent preserved
    expect(result).toEqual([
      {
        id: 'T1',
        projectId: 'P1',
        sectionId: 'S1',
        parentId: null,
        content: 'Fix the widget',
        labels: ['task'],
        isCompleted: false,
        url: 'https://app.todoist.com/app/task/T1',
      },
      {
        id: 'T2',
        projectId: 'P1',
        sectionId: null,
        parentId: 'T1',
        content: 'A to-do',
        labels: ['todo'],
        isCompleted: false,
        url: 'https://app.todoist.com/app/task/T2',
      },
    ]);
    // And the GET scoped to the project
    expect(calls[0]!.path).toBe('/tasks?project_id=P1');
  });

  it('queries completed tasks by completion date within the clock window', async () => {
    // Given — a completed-task response keyed by task_id
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

    // When — the adapter fetches completions since a cursor
    const result = await adapter.fetchCompletedTasks(
      'P1',
      '2026-09-24T10:00:00Z',
    );

    // Then — the task id is taken from task_id and marked completed
    expect(result).toEqual([
      {
        id: 'T1',
        projectId: 'P1',
        sectionId: 'S1',
        parentId: null,
        content: 'Fix the widget',
        labels: ['task'],
        isCompleted: true,
        url: 'https://app.todoist.com/app/task/T1',
      },
    ]);
    // And the GET carried since, until and the project scope
    expect(calls[0]!.path).toBe(
      '/tasks/completed/by_completion_date?since=2026-09-24T10%3A00%3A00Z&until=2026-09-24T12%3A00%3A00.000Z&project_id=P1',
    );
  });

  it('creates a task with the full placement and label payload', async () => {
    // Given — a create response
    const { transport, calls } = fakeTransport([
      { status: 200, json: task({ id: 'T9', content: 'New' }) },
    ]);
    const adapter = new TodoistAdapter(transport);
    const input: CreateTodoistTaskData = {
      projectId: 'P1',
      sectionId: 'S1',
      content: 'New',
      labels: ['task'],
      description: 'https://github.com/acme/widgets/issues/42',
    };

    // When — the adapter creates the task
    const result = await adapter.createTask(input);

    // Then — the created task is mapped
    expect(result.id).toBe('T9');
    // And the POST carried every provided field
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/tasks',
      body: JSON.stringify({
        content: 'New',
        project_id: 'P1',
        section_id: 'S1',
        labels: ['task'],
        description: 'https://github.com/acme/widgets/issues/42',
      }),
    });
  });

  it('omits absent optional fields when creating a task', async () => {
    // Given — a create response
    const { transport, calls } = fakeTransport([
      { status: 200, json: task({ id: 'T9' }) },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter creates a task with only the required fields
    await adapter.createTask({ projectId: 'P1', content: 'Bare' });

    // Then — the POST carries only content and project_id
    expect(calls[0]!.body).toBe(
      JSON.stringify({ content: 'Bare', project_id: 'P1' }),
    );
  });

  it('updates a task’s content and labels', async () => {
    // Given — an accepted update
    const { transport, calls } = fakeTransport([{ status: 200, json: {} }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter updates the task
    await adapter.updateTask('T1', { content: 'Renamed', labels: ['bug'] });

    // Then — the POST targeted the task with the new content and labels
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/tasks/T1',
      body: JSON.stringify({ content: 'Renamed', labels: ['bug'] }),
    });
  });

  it('moves a task into a section via the move endpoint', async () => {
    // Given — an accepted move
    const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter moves the task to a section
    await adapter.moveTask('T1', { sectionId: 'S2' });

    // Then — the POST targeted the move endpoint with section_id only
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/tasks/T1/move',
      body: JSON.stringify({ section_id: 'S2' }),
    });
  });

  it('moves a task under a parent via the move endpoint', async () => {
    // Given — an accepted move
    const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter moves the task under a parent
    await adapter.moveTask('T2', { parentId: 'T1' });

    // Then — the POST carried parent_id only
    expect(calls[0]!.body).toBe(JSON.stringify({ parent_id: 'T1' }));
  });

  it('refuses a move with neither section nor parent', async () => {
    // Given — an adapter with no queued responses
    const { transport, calls } = fakeTransport([]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter is asked to move with no destination
    // Then — it fails before any request, since the API needs exactly one
    await expect(adapter.moveTask('T1', {})).rejects.toThrow(/exactly one/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a move with both section and parent', async () => {
    // Given — an adapter with no queued responses
    const { transport, calls } = fakeTransport([]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter is asked to move to two destinations at once
    // Then — it fails before any request
    await expect(
      adapter.moveTask('T1', { sectionId: 'S2', parentId: 'T1' }),
    ).rejects.toThrow(/exactly one/);
    expect(calls).toHaveLength(0);
  });

  it('completes a task via the close endpoint', async () => {
    // Given — an accepted close
    const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter completes the task
    await adapter.setTaskCompleted('T1', true);

    // Then — the POST targeted the close endpoint
    expect(calls[0]!.path).toBe('/tasks/T1/close');
  });

  it('reopens a task via the reopen endpoint', async () => {
    // Given — an accepted reopen
    const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter reopens the task
    await adapter.setTaskCompleted('T1', false);

    // Then — the POST targeted the reopen endpoint
    expect(calls[0]!.path).toBe('/tasks/T1/reopen');
  });

  it('deletes a task', async () => {
    // Given — an accepted delete
    const { transport, calls } = fakeTransport([{ status: 204, json: null }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter deletes the task
    await adapter.deleteTask('T1');

    // Then — the DELETE targeted the task
    expect(calls[0]).toEqual({ method: 'DELETE', path: '/tasks/T1', body: '' });
  });

  it('no-ops ensureLabel when the label already exists', async () => {
    // Given — a labels list already containing the label
    const { transport, calls } = fakeTransport([
      {
        status: 200,
        json: { results: [{ id: 'L1', name: 'task' }], next_cursor: null },
      },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter ensures the existing label
    await adapter.ensureLabel('task');

    // Then — only the list request was made, no create
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
  });

  it('creates a label when it is missing', async () => {
    // Given — a labels list without the label
    const { transport, calls } = fakeTransport([
      { status: 200, json: { results: [], next_cursor: null } },
      { status: 200, json: { id: 'L2', name: 'slice' } },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter ensures the missing label
    await adapter.ensureLabel('slice');

    // Then — the label is created
    expect(calls[1]).toEqual({
      method: 'POST',
      path: '/labels',
      body: JSON.stringify({ name: 'slice' }),
    });
  });

  it('throws a clear error when a request fails', async () => {
    // Given — a transport rejecting the request
    const { transport } = fakeTransport([{ status: 401, json: {} }]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter fetches the projects
    // Then — it fails with the status in the message
    await expect(adapter.fetchProjects()).rejects.toThrow(/status 401/);
  });

  it('throws a clear error on an unexpected list shape', async () => {
    // Given — a transport returning a non-list payload
    const { transport } = fakeTransport([
      { status: 200, json: { nope: true } },
    ]);
    const adapter = new TodoistAdapter(transport);

    // When — the adapter fetches the projects
    // Then — it fails with a shape error
    await expect(adapter.fetchProjects()).rejects.toThrow(
      /list response shape/,
    );
  });
});
