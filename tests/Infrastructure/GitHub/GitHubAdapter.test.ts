import { describe, expect, it } from 'vitest';
import { GitHubAdapter, type Transport } from '../../../src/Infrastructure/GitHub/GitHubAdapter.js';
import type { AttachProjectData } from '../../../src/Domain/DataTransferObjects/AttachProjectData.js';

// A fake transport at the boundary: returns canned responses in call order
// and records the request bodies/paths, so the adapter's mapping is what's
// under test — never a real GitHub call.
function fakeTransport(responses: Array<{ status: number; json: unknown }>) {
  const bodies: string[] = [];
  const paths: string[] = [];
  const transport: Transport = {
    async post(body) {
      bodies.push(body);
      const next = responses.shift();
      if (!next) {
        throw new Error('fake transport: no more responses queued');
      }
      return next;
    },
    async get(path) {
      paths.push(path);
      const next = responses.shift();
      if (!next) {
        throw new Error('fake transport: no more responses queued');
      }
      return next;
    },
    async patch(path, body) {
      paths.push(path);
      bodies.push(body);
      const next = responses.shift();
      if (!next) {
        throw new Error('fake transport: no more responses queued');
      }
      return next;
    },
  };
  return { transport, bodies, paths };
}

const repoResponse = { status: 200, json: { data: { repository: { id: 'R_kgDOAAAA' } } } };

const userProjectResponse = {
  status: 200,
  json: {
    data: {
      user: {
        projectV2: {
          id: 'PVT_123',
          fields: {
            nodes: [
              { id: 'PVTF_456', name: 'Status', options: [
                { id: 'PVTSSF_1', name: 'Todo' },
                { id: 'PVTSSF_2', name: 'Done' },
              ] },
            ],
          },
        },
      },
    },
  },
};

const orgProjectResponse = {
  status: 200,
  json: {
    data: {
      organization: {
        projectV2: {
          id: 'PVT_789',
          fields: {
            nodes: [
              { id: 'PVTF_101', name: 'Status', options: [
                { id: 'PVTSSF_3', name: 'In progress' },
              ] },
            ],
          },
        },
      },
    },
  },
};

describe('GitHubAdapter', () => {
  it('resolves identities for a user board url', async () => {
    // Given — a user-scoped board and a transport that resolves it
    const { transport, bodies } = fakeTransport([repoResponse, userProjectResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    // When — the adapter resolves the identity
    const result = await adapter.fetchProjectIdentity(data);

    // Then — the DTO carries the resolved identities
    expect(result).toEqual({
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Todo' },
        { id: 'PVTSSF_2', name: 'Done' },
      ],
    });
    // And the repo query targeted the bound owner/name
    expect(bodies[0]).toContain('repository');
    expect(bodies[0]).toContain('"owner":"acme"');
    expect(bodies[0]).toContain('"name":"widgets"');
    // And the project query targeted the user login and project number
    expect(bodies[1]).toContain('user');
    expect(bodies[1]).toContain('"login":"acme"');
    expect(bodies[1]).toContain('"number":1');
  });

  it('resolves identities for an org board url', async () => {
    // Given — an org-scoped board and a transport that resolves it
    const { transport, bodies } = fakeTransport([repoResponse, orgProjectResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/orgs/acme/projects/2',
    };

    // When — the adapter resolves the identity
    const result = await adapter.fetchProjectIdentity(data);

    // Then — the DTO carries the resolved identities
    expect(result).toEqual({
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_789',
      statusFieldId: 'PVTF_101',
      statusOptions: [{ id: 'PVTSSF_3', name: 'In progress' }],
    });
    // And the project query targeted the organization login and number
    expect(bodies[1]).toContain('organization');
    expect(bodies[1]).toContain('"login":"acme"');
    expect(bodies[1]).toContain('"number":2');
  });

  it('maps a raw response onto the identity DTO', async () => {
    // Given — a transport returning a raw GraphQL payload
    const { transport } = fakeTransport([repoResponse, userProjectResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    // When — the adapter resolves the identity
    const result = await adapter.fetchProjectIdentity(data);

    // Then — only the fields the core needs are surfaced, in DTO shape
    expect(result).not.toBeNull();
    expect(result!.statusFieldId).toBe('PVTF_456');
    expect(result!.statusOptions).toHaveLength(2);
    expect(result!.statusOptions[0]).toEqual({ id: 'PVTSSF_1', name: 'Todo' });
  });

  it('throws when the project has no Status field', async () => {
    // Given — a project whose fields contain no Status single-select
    const noStatus = {
      status: 200,
      json: {
        data: {
          user: {
            projectV2: {
              id: 'PVT_123',
              fields: { nodes: [{ id: 'PVTF_999', name: 'Priority', options: [] }] },
            },
          },
        },
      },
    };

    // When — the adapter resolves the identity
    const { transport } = fakeTransport([repoResponse, noStatus]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    // Then — it fails with a clear error
    await expect(adapter.fetchProjectIdentity(data)).rejects.toThrow(/Status/);
  });

  it('maps raw issues onto TaskData and filters out non-task issues', async () => {
    // Given — a REST response mixing a task issue with a non-task issue
    const issuesResponse = {
      status: 200,
      json: [
        {
          html_url: 'https://github.com/acme/widgets/issues/42',
          number: 42,
          title: 'Fix the Bug!',
          body: 'The bug happens when the widget is resized.',
          state: 'open',
          updated_at: '2026-09-18T10:00:00Z',
          labels: [{ name: 'type:task' }, { name: 'bug' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/43',
          number: 43,
          title: 'A slice',
          body: 'Not a task.',
          state: 'open',
          updated_at: '2026-09-18T11:00:00Z',
          labels: [{ name: 'type:slice' }],
        },
      ],
    };
    const { transport, paths } = fakeTransport([issuesResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');

    // When — the adapter fetches changed tasks since a cursor
    const result = await adapter.fetchChangedTasks('2026-09-18T00:00:00Z');

    // Then — only the type:task issue is surfaced, mapped onto TaskData
    expect(result).toEqual([
      {
        url: 'https://github.com/acme/widgets/issues/42',
        remoteId: 42,
        title: 'Fix the Bug!',
        body: 'The bug happens when the widget is resized.',
        state: 'open',
        updatedAt: '2026-09-18T10:00:00Z',
        labels: ['type:task', 'bug'],
      },
    ]);
    // And the REST path targeted the bound repo with the since cursor
    expect(paths[0]).toBe(
      '/repos/acme/widgets/issues?state=all&since=2026-09-18T00%3A00%3A00Z&per_page=100',
    );
  });

  it('maps a closed issue to a closed task state', async () => {
    // Given — a REST response with a closed task issue
    const issuesResponse = {
      status: 200,
      json: [
        {
          html_url: 'https://github.com/acme/widgets/issues/7',
          number: 7,
          title: 'Close me',
          body: 'Done.',
          state: 'closed',
          updated_at: '2026-09-18T09:00:00Z',
          labels: [{ name: 'type:task' }],
        },
      ],
    };
    const { transport } = fakeTransport([issuesResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');

    // When — the adapter fetches changed tasks
    const result = await adapter.fetchChangedTasks('2026-09-18T00:00:00Z');

    // Then — the state is closed
    expect(result[0]!.state).toBe('closed');
  });

  it('fetches a single task by its issue url', async () => {
    // Given — a REST response for one issue
    const issueResponse = {
      status: 200,
      json: {
        html_url: 'https://github.com/acme/widgets/issues/42',
        number: 42,
        title: 'Fix the Bug!',
        body: 'The bug happens when the widget is resized.',
        state: 'open',
        updated_at: '2026-09-18T10:00:00Z',
        labels: [{ name: 'type:task' }],
      },
    };
    const { transport, paths } = fakeTransport([issueResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');

    // When — the adapter fetches the task by url
    const result = await adapter.fetchTask('https://github.com/acme/widgets/issues/42');

    // Then — the issue is mapped onto TaskData
    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      remoteId: 42,
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state: 'open',
      updatedAt: '2026-09-18T10:00:00Z',
      labels: ['type:task'],
    });
    // And the REST path targeted the bound repo and issue number
    expect(paths[0]).toBe('/repos/acme/widgets/issues/42');
  });

  it('updates a task and returns the updated issue', async () => {
    // Given — a REST response for the updated issue
    const updatedResponse = {
      status: 200,
      json: {
        html_url: 'https://github.com/acme/widgets/issues/42',
        number: 42,
        title: 'fix the widget',
        body: 'The bug now also happens on resize.',
        state: 'open',
        updated_at: '2026-09-18T12:30:00Z',
        labels: [{ name: 'type:task' }],
      },
    };
    const { transport, paths, bodies } = fakeTransport([updatedResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');

    // When — the adapter updates the task
    const result = await adapter.updateTask('https://github.com/acme/widgets/issues/42', {
      title: 'fix the widget',
      body: 'The bug now also happens on resize.',
    });

    // Then — the updated issue is mapped onto TaskData
    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      remoteId: 42,
      title: 'fix the widget',
      body: 'The bug now also happens on resize.',
      state: 'open',
      updatedAt: '2026-09-18T12:30:00Z',
      labels: ['type:task'],
    });
    // And the PATCH targeted the bound repo and issue number with the input
    expect(paths[0]).toBe('/repos/acme/widgets/issues/42');
    expect(bodies[0]).toBe(
      JSON.stringify({ title: 'fix the widget', body: 'The bug now also happens on resize.' }),
    );
  });
});
