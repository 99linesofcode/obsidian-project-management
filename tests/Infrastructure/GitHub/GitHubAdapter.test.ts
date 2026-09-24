import { describe, expect, it } from 'vitest';
import {
  GitHubAdapter,
  type Transport,
} from '../../../src/Infrastructure/GitHub/GitHubAdapter.js';
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
    async postPath(path, body) {
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

const repoResponse = {
  status: 200,
  json: { data: { repository: { id: 'R_kgDOAAAA' } } },
};

const userProjectResponse = {
  status: 200,
  json: {
    data: {
      user: {
        projectV2: {
          id: 'PVT_123',
          fields: {
            nodes: [
              {
                id: 'PVTF_456',
                name: 'Status',
                options: [
                  { id: 'PVTSSF_1', name: 'Unshaped' },
                  { id: 'PVTSSF_2', name: 'Done' },
                ],
              },
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
              {
                id: 'PVTF_101',
                name: 'Status',
                options: [{ id: 'PVTSSF_3', name: 'Building' }],
              },
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
    const { transport, bodies } = fakeTransport([
      repoResponse,
      userProjectResponse,
    ]);
    const adapter = new GitHubAdapter(transport);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    // When — the adapter resolves the identity
    const result = await adapter.fetchProjectIdentity(data);

    // Then — the DTO carries the resolved identities
    expect(result).toEqual({
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Unshaped' },
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
    const { transport, bodies } = fakeTransport([
      repoResponse,
      orgProjectResponse,
    ]);
    const adapter = new GitHubAdapter(transport);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/orgs/acme/projects/2',
    };

    // When — the adapter resolves the identity
    const result = await adapter.fetchProjectIdentity(data);

    // Then — the DTO carries the resolved identities
    expect(result).toEqual({
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_789',
      statusFieldId: 'PVTF_101',
      statusOptions: [{ id: 'PVTSSF_3', name: 'Building' }],
    });
    // And the project query targeted the organization login and number
    expect(bodies[1]).toContain('organization');
    expect(bodies[1]).toContain('"login":"acme"');
    expect(bodies[1]).toContain('"number":2');
  });

  it('maps a raw response onto the identity DTO', async () => {
    // Given — a transport returning a raw GraphQL payload
    const { transport } = fakeTransport([repoResponse, userProjectResponse]);
    const adapter = new GitHubAdapter(transport);
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
    expect(result!.statusOptions[0]).toEqual({
      id: 'PVTSSF_1',
      name: 'Unshaped',
    });
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
              fields: {
                nodes: [{ id: 'PVTF_999', name: 'Priority', options: [] }],
              },
            },
          },
        },
      },
    };

    // When — the adapter resolves the identity
    const { transport } = fakeTransport([repoResponse, noStatus]);
    const adapter = new GitHubAdapter(transport);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    // Then — it fails with a clear error
    await expect(adapter.fetchProjectIdentity(data)).rejects.toThrow(/Status/);
  });

  it('keeps issues carrying any type label — task, bug, chore, slice', async () => {
    // Given — a REST response mixing every type label with an untyped issue
    const issuesResponse = {
      status: 200,
      json: [
        {
          html_url: 'https://github.com/acme/widgets/issues/42',
          number: 42,
          node_id: 'I_kwDOAAAA42',
          title: 'Fix the Bug!',
          body: 'The bug happens when the widget is resized.',
          state: 'open',
          updated_at: '2026-09-18T10:00:00Z',
          labels: [{ name: 'type: task' }, { name: 'bug' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/43',
          number: 43,
          node_id: 'I_kwDOAAAA43',
          title: 'A slice',
          body: 'A slice of the feature.',
          state: 'open',
          updated_at: '2026-09-18T11:00:00Z',
          labels: [{ name: 'type: slice' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/44',
          number: 44,
          node_id: 'I_kwDOAAAA44',
          title: 'A defect',
          body: 'Something is broken.',
          state: 'open',
          updated_at: '2026-09-18T12:00:00Z',
          labels: [{ name: 'type: bug' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/45',
          number: 45,
          node_id: 'I_kwDOAAAA45',
          title: 'A chore',
          body: 'Routine upkeep.',
          state: 'open',
          updated_at: '2026-09-18T13:00:00Z',
          labels: [{ name: 'type: chore' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/46',
          number: 46,
          node_id: 'I_kwDOAAAA46',
          title: 'Untyped',
          body: 'No type label.',
          state: 'open',
          updated_at: '2026-09-18T14:00:00Z',
          labels: [{ name: 'bug' }],
        },
      ],
    };
    const { transport, paths } = fakeTransport([issuesResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter fetches changed tasks since a cursor
    const result = await adapter.fetchChangedTasks(
      'https://github.com/acme/widgets',
      '2026-09-18T00:00:00Z',
    );

    // Then — every typed issue is surfaced, mapped onto TaskData
    expect(result.map((task) => task.remoteId)).toEqual([42, 43, 44, 45]);
    expect(result[0]).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      remoteId: 42,
      nodeId: 'I_kwDOAAAA42',
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state: 'open',
      updatedAt: '2026-09-18T10:00:00Z',
      labels: ['type: task', 'bug'],
    });
    // And the untyped issue is filtered out
    expect(result.some((task) => task.remoteId === 46)).toBe(false);
    // And the REST path targeted the bound repo with the since cursor
    expect(paths[0]).toBe(
      '/repos/acme/widgets/issues?state=all&since=2026-09-18T00%3A00%3A00Z&per_page=100',
    );
  });

  it('treats the legacy no-space type label as typed', async () => {
    // Given — a REST response with an issue labelled type:task (no space),
    // which predates the spaced convention but still names a type
    const issuesResponse = {
      status: 200,
      json: [
        {
          html_url: 'https://github.com/acme/widgets/issues/42',
          number: 42,
          node_id: 'I_kwDOAAAA42',
          title: 'Fix the Bug!',
          body: 'The bug happens when the widget is resized.',
          state: 'open',
          updated_at: '2026-09-18T10:00:00Z',
          labels: [{ name: 'type:task' }],
        },
      ],
    };
    const { transport } = fakeTransport([issuesResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter fetches changed tasks
    const result = await adapter.fetchChangedTasks(
      'https://github.com/acme/widgets',
      '2026-09-18T00:00:00Z',
    );

    // Then — the issue is surfaced, since any type: label marks it tracked
    expect(result.map((task) => task.remoteId)).toEqual([42]);
  });

  it('omits the since filter when no cursor is given', async () => {
    // Given — a REST response and a transport that records the requested path
    const issuesResponse = { status: 200, json: [] };
    const { transport, paths } = fakeTransport([issuesResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter fetches changed tasks with no since cursor
    const result = await adapter.fetchChangedTasks(
      'https://github.com/acme/widgets',
    );

    // Then — the since filter is omitted from the requested path
    expect(paths[0]).toBe('/repos/acme/widgets/issues?state=all&per_page=100');
    expect(result).toEqual([]);
  });

  it('maps a closed issue to a closed task state', async () => {
    // Given — a REST response with a closed task issue
    const issuesResponse = {
      status: 200,
      json: [
        {
          html_url: 'https://github.com/acme/widgets/issues/7',
          number: 7,
          node_id: 'I_kwDOAAAA7',
          title: 'Close me',
          body: 'Done.',
          state: 'closed',
          updated_at: '2026-09-18T09:00:00Z',
          labels: [{ name: 'type: task' }],
        },
      ],
    };
    const { transport } = fakeTransport([issuesResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter fetches changed tasks
    const result = await adapter.fetchChangedTasks(
      'https://github.com/acme/widgets',
      '2026-09-18T00:00:00Z',
    );

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
        node_id: 'I_kwDOAAAA42',
        title: 'Fix the Bug!',
        body: 'The bug happens when the widget is resized.',
        state: 'open',
        updated_at: '2026-09-18T10:00:00Z',
        labels: [{ name: 'type: task' }],
      },
    };
    const { transport, paths } = fakeTransport([issueResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter fetches the task by url
    const result = await adapter.fetchTask(
      'https://github.com/acme/widgets/issues/42',
    );

    // Then — the issue is mapped onto TaskData
    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      remoteId: 42,
      nodeId: 'I_kwDOAAAA42',
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state: 'open',
      updatedAt: '2026-09-18T10:00:00Z',
      labels: ['type: task'],
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
        node_id: 'I_kwDOAAAA42',
        title: 'fix the widget',
        body: 'The bug now also happens on resize.',
        state: 'open',
        updated_at: '2026-09-18T12:30:00Z',
        labels: [{ name: 'type: task' }],
      },
    };
    const { transport, paths, bodies } = fakeTransport([updatedResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter updates the task
    const result = await adapter.updateTask(
      'https://github.com/acme/widgets/issues/42',
      {
        title: 'fix the widget',
        body: 'The bug now also happens on resize.',
      },
    );

    // Then — the updated issue is mapped onto TaskData
    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      remoteId: 42,
      nodeId: 'I_kwDOAAAA42',
      title: 'fix the widget',
      body: 'The bug now also happens on resize.',
      state: 'open',
      updatedAt: '2026-09-18T12:30:00Z',
      labels: ['type: task'],
    });
    // And the PATCH targeted the bound repo and issue number with the input
    expect(paths[0]).toBe('/repos/acme/widgets/issues/42');
    expect(bodies[0]).toBe(
      JSON.stringify({
        title: 'fix the widget',
        body: 'The bug now also happens on resize.',
      }),
    );
  });

  it('sets a task state and returns the updated issue', async () => {
    // Given — a REST response for the closed issue
    const closedResponse = {
      status: 200,
      json: {
        html_url: 'https://github.com/acme/widgets/issues/42',
        number: 42,
        node_id: 'I_kwDOAAAA42',
        title: 'Fix the Bug!',
        body: 'The bug happens when the widget is resized.',
        state: 'closed',
        updated_at: '2026-09-18T12:30:00Z',
        labels: [{ name: 'type: task' }],
      },
    };
    const { transport, paths, bodies } = fakeTransport([closedResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter sets the task state to closed
    const result = await adapter.setTaskState(
      'https://github.com/acme/widgets/issues/42',
      'closed',
    );

    // Then — the updated issue is mapped onto TaskData
    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      remoteId: 42,
      nodeId: 'I_kwDOAAAA42',
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state: 'closed',
      updatedAt: '2026-09-18T12:30:00Z',
      labels: ['type: task'],
    });
    // And the PATCH targeted the bound repo and issue number with the state
    expect(paths[0]).toBe('/repos/acme/widgets/issues/42');
    expect(bodies[0]).toBe(JSON.stringify({ state: 'closed' }));
  });

  it('maps board items onto the DTO, distinguishing issues from draft cards', async () => {
    // Given — a GraphQL board items response with an issue and a draft card
    const boardResponse = {
      status: 200,
      json: {
        data: {
          node: {
            items: {
              nodes: [
                {
                  id: 'PVTI_1',
                  type: 'ISSUE',
                  content: { url: 'https://github.com/acme/widgets/issues/42' },
                  fieldValues: {
                    nodes: [
                      { name: 'Done', field: { name: 'Status' } },
                      { name: 'High', field: { name: 'Priority' } },
                    ],
                  },
                },
                {
                  id: 'PVTI_2',
                  type: 'DRAFT_ISSUE',
                  content: null,
                  fieldValues: { nodes: [] },
                },
              ],
            },
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([boardResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter fetches the board items
    const result = await adapter.fetchBoardItems('PVT_123');

    // Then — the issue and draft card are mapped onto the DTO
    expect(result).toEqual([
      {
        itemId: 'PVTI_1',
        type: 'ISSUE',
        issueUrl: 'https://github.com/acme/widgets/issues/42',
        statusOptionName: 'Done',
      },
      {
        itemId: 'PVTI_2',
        type: 'DRAFT_ISSUE',
        issueUrl: undefined,
        statusOptionName: undefined,
      },
    ]);
    // And the query targeted the project node id
    expect(bodies[0]).toContain('BoardItems');
    expect(bodies[0]).toContain('"projectId":"PVT_123"');
  });

  it('maps draft card title and body onto the board item DTO', async () => {
    // Given — a GraphQL board items response with a draft card carrying a
    // title and body
    const boardResponse = {
      status: 200,
      json: {
        data: {
          node: {
            items: {
              nodes: [
                {
                  id: 'PVTI_2',
                  type: 'DRAFT_ISSUE',
                  content: { title: 'An idea', body: 'The draft body.' },
                  fieldValues: { nodes: [] },
                },
              ],
            },
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([boardResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter fetches the board items
    const result = await adapter.fetchBoardItems('PVT_123');

    // Then — the draft title and body are surfaced on the DTO
    expect(result).toEqual([
      {
        itemId: 'PVTI_2',
        type: 'DRAFT_ISSUE',
        draftTitle: 'An idea',
        draftBody: 'The draft body.',
      },
    ]);
    // And the query asks for the draft content
    expect(bodies[0]).toContain('DraftIssue');
  });

  it('promotes a draft card to an issue and fetches the full task', async () => {
    // Given — a transport that converts the draft card and then returns the
    // new issue via REST
    const mutationResponse = {
      status: 200,
      json: {
        data: {
          convertProjectV2DraftIssueItemToIssue: {
            item: {
              id: 'PVTI_2',
              content: { url: 'https://github.com/acme/widgets/issues/50' },
            },
          },
        },
      },
    };
    const issueResponse = {
      status: 200,
      json: {
        html_url: 'https://github.com/acme/widgets/issues/50',
        number: 50,
        node_id: 'I_kwDOAAAA50',
        title: 'An idea',
        body: 'The draft body.',
        state: 'open',
        updated_at: '2026-09-19T10:00:00Z',
        labels: [],
      },
    };
    const { transport, bodies, paths } = fakeTransport([
      mutationResponse,
      issueResponse,
    ]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter promotes the draft card
    const result = await adapter.promoteCard('PVTI_2', 'R_kgDOAAAA');

    // Then — the mutation targeted the item and repository, and the new issue
    // is fetched in full and mapped onto TaskData
    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/50',
      remoteId: 50,
      nodeId: 'I_kwDOAAAA50',
      title: 'An idea',
      body: 'The draft body.',
      state: 'open',
      updatedAt: '2026-09-19T10:00:00Z',
      labels: [],
    });
    expect(bodies[0]).toContain('ConvertDraftIssue');
    expect(bodies[0]).toContain('"itemId":"PVTI_2"');
    expect(bodies[0]).toContain('"repositoryId":"R_kgDOAAAA"');
    expect(paths[0]).toBe('/repos/acme/widgets/issues/50');
  });

  it('sets a board item status via updateProjectV2ItemFieldValue', async () => {
    // Given — a board containing the issue and a transport for the two calls
    const boardResponse = {
      status: 200,
      json: {
        data: {
          node: {
            items: {
              nodes: [
                {
                  id: 'PVTI_1',
                  type: 'ISSUE',
                  content: { url: 'https://github.com/acme/widgets/issues/42' },
                  fieldValues: {
                    nodes: [{ name: 'Unshaped', field: { name: 'Status' } }],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const mutationResponse = {
      status: 200,
      json: { data: { projectV2Item: { id: 'PVTI_1' } } },
    };
    const { transport, bodies } = fakeTransport([
      boardResponse,
      mutationResponse,
    ]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter sets the board status to the done option
    await adapter.setBoardStatus(
      'PVT_123',
      'PVTF_456',
      'https://github.com/acme/widgets/issues/42',
      'PVTSSF_3',
    );

    // Then — the item id is resolved from the board and the field value is updated
    expect(bodies[1]).toContain('SetBoardStatus');
    expect(bodies[1]).toContain('"itemId":"PVTI_1"');
    expect(bodies[1]).toContain('"fieldId":"PVTF_456"');
    expect(bodies[1]).toContain('"optionId":"PVTSSF_3"');
  });

  it('adds an issue to the board via addProjectV2ItemById', async () => {
    // Given — a REST issue response and a transport for the two calls
    const issueResponse = {
      status: 200,
      json: {
        html_url: 'https://github.com/acme/widgets/issues/42',
        number: 42,
        node_id: 'I_kwDOAAAA42',
        title: 'Fix the Bug!',
        body: 'The bug happens when the widget is resized.',
        state: 'open',
        updated_at: '2026-09-18T10:00:00Z',
        labels: [{ name: 'type: task' }],
      },
    };
    const mutationResponse = {
      status: 200,
      json: { data: { item: { id: 'PVTI_9' } } },
    };
    const { transport, bodies } = fakeTransport([
      issueResponse,
      mutationResponse,
    ]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter adds the issue to the board
    await adapter.addBoardItem(
      'PVT_123',
      'https://github.com/acme/widgets/issues/42',
    );

    // Then — the issue's node id is resolved from the REST response and added
    expect(bodies[0]).toContain('AddBoardItem');
    expect(bodies[0]).toContain('"contentId":"I_kwDOAAAA42"');
    expect(bodies[0]).toContain('"projectId":"PVT_123"');
  });

  it('lists open issues that carry no type label', async () => {
    // Given — a REST response mixing typed issues (task, slice, bug, chore)
    // with an unlabeled one
    const issuesResponse = {
      status: 200,
      json: [
        {
          html_url: 'https://github.com/acme/widgets/issues/42',
          number: 42,
          node_id: 'I_kwDOAAAA42',
          title: 'Fix the Bug!',
          body: 'The bug happens when the widget is resized.',
          state: 'open',
          updated_at: '2026-09-18T10:00:00Z',
          labels: [{ name: 'type: task' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/43',
          number: 43,
          node_id: 'I_kwDOAAAA43',
          title: 'A slice',
          body: 'A slice of the feature.',
          state: 'open',
          updated_at: '2026-09-18T11:00:00Z',
          labels: [{ name: 'type: slice' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/44',
          number: 44,
          node_id: 'I_kwDOAAAA44',
          title: 'A defect',
          body: 'Something is broken.',
          state: 'open',
          updated_at: '2026-09-18T12:00:00Z',
          labels: [{ name: 'type: bug' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/45',
          number: 45,
          node_id: 'I_kwDOAAAA45',
          title: 'A chore',
          body: 'Routine upkeep.',
          state: 'open',
          updated_at: '2026-09-18T13:00:00Z',
          labels: [{ name: 'type: chore' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/46',
          number: 46,
          node_id: 'I_kwDOAAAA46',
          title: 'An idea',
          body: 'No labels yet.',
          state: 'open',
          updated_at: '2026-09-18T14:00:00Z',
          labels: [],
        },
      ],
    };
    const { transport, paths } = fakeTransport([issuesResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter lists unpromoted issues
    const result = await adapter.fetchUnpromotedIssues(
      'https://github.com/acme/widgets',
    );

    // Then — only the unlabeled issue is surfaced, mapped onto TaskData
    expect(result).toEqual([
      {
        url: 'https://github.com/acme/widgets/issues/46',
        remoteId: 46,
        nodeId: 'I_kwDOAAAA46',
        title: 'An idea',
        body: 'No labels yet.',
        state: 'open',
        updatedAt: '2026-09-18T14:00:00Z',
        labels: [],
      },
    ]);
    // And the REST path targeted the bound repo with open issues
    expect(paths[0]).toBe('/repos/acme/widgets/issues?state=open&per_page=100');
  });

  it('excludes issues carrying any type label from the unpromoted list', async () => {
    // Given — a REST response with one issue per type label
    const issuesResponse = {
      status: 200,
      json: [
        {
          html_url: 'https://github.com/acme/widgets/issues/42',
          number: 42,
          node_id: 'I_kwDOAAAA42',
          title: 'Fix the Bug!',
          body: 'The bug happens when the widget is resized.',
          state: 'open',
          updated_at: '2026-09-18T10:00:00Z',
          labels: [{ name: 'type: task' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/43',
          number: 43,
          node_id: 'I_kwDOAAAA43',
          title: 'A slice',
          body: 'A slice of the feature.',
          state: 'open',
          updated_at: '2026-09-18T11:00:00Z',
          labels: [{ name: 'type: slice' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/44',
          number: 44,
          node_id: 'I_kwDOAAAA44',
          title: 'A defect',
          body: 'Something is broken.',
          state: 'open',
          updated_at: '2026-09-18T12:00:00Z',
          labels: [{ name: 'type: bug' }],
        },
        {
          html_url: 'https://github.com/acme/widgets/issues/45',
          number: 45,
          node_id: 'I_kwDOAAAA45',
          title: 'A chore',
          body: 'Routine upkeep.',
          state: 'open',
          updated_at: '2026-09-18T13:00:00Z',
          labels: [{ name: 'type: chore' }],
        },
      ],
    };
    const { transport } = fakeTransport([issuesResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter lists unpromoted issues
    const result = await adapter.fetchUnpromotedIssues(
      'https://github.com/acme/widgets',
    );

    // Then — none are surfaced; every typed issue is already tracked
    expect(result).toEqual([]);
  });

  it('adds a label to an issue via the labels endpoint', async () => {
    // Given — a transport that accepts the label POST
    const labelsResponse = { status: 200, json: [{ name: 'type: task' }] };
    const { transport, paths, bodies } = fakeTransport([labelsResponse]);
    const adapter = new GitHubAdapter(transport);

    // When — the adapter adds the label to the issue
    await adapter.addLabel(
      'https://github.com/acme/widgets/issues/42',
      'type: task',
    );

    // Then — the POST targeted the bound repo, issue and labels endpoint
    expect(paths[0]).toBe('/repos/acme/widgets/issues/42/labels');
    expect(bodies[0]).toBe(JSON.stringify({ labels: ['type: task'] }));
  });

  it('reports an invalid repo url clearly instead of a TypeError', async () => {
    // Given — an adapter and an empty repo url
    const { transport } = fakeTransport([]);
    const adapter = new GitHubAdapter(transport);

    // When — a repo-scoped call is made with the empty url
    // Then — it fails with a clear error, not a raw TypeError
    await expect(
      adapter.fetchChangedTasks('', '2026-09-18T00:00:00Z'),
    ).rejects.toThrow(/invalid repo url/);
  });

  it('reports an invalid board url clearly instead of a TypeError', async () => {
    // Given — an adapter and an empty board url
    const { transport } = fakeTransport([]);
    const adapter = new GitHubAdapter(transport);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: '',
    };

    // When — the identity is resolved with the empty board url
    // Then — it fails with a clear error, not a raw TypeError
    await expect(adapter.fetchProjectIdentity(data)).rejects.toThrow(
      /invalid board url/,
    );
  });
});
