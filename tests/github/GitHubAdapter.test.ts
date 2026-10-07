import { describe, expect, it } from 'vitest';
import {
  GitHubAdapter,
  type Transport,
} from '../../src/github/GitHubAdapter.js';
import type { AttachProjectData } from '../../src/shared/AttachProjectData.js';
import { BoardStatusData } from '../../src/shared/BoardStatusData.js';

// A fake transport at the boundary: returns canned responses in call order
// and records the request bodies/paths, so the adapter's mapping is what's
// under test — never a real GitHub call.
function fakeTransport(
  responses: Array<{ status: number; json: unknown; etag?: string }>,
) {
  const bodies: string[] = [];
  const paths: string[] = [];
  const etags: Array<string | undefined> = [];
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
    async getConditional(path, etag) {
      paths.push(path);
      etags.push(etag);
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
  return { transport, bodies, paths, etags };
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

// A typed issue in GitHub's REST shape, for building multi-page responses.
function issue(number: number) {
  return {
    html_url: `https://github.com/acme/widgets/issues/${number}`,
    number,
    node_id: `I_kwDOAAAA${number}`,
    title: `Issue ${number}`,
    body: `Body ${number}`,
    state: 'open',
    updated_at: '2026-09-18T10:00:00Z',
    labels: [{ name: 'type: task' }],
  };
}

describe('ATT-1 — a project attaches by resolving its repo and board identity', () => {
  it('resolves identities for a user or org board url', async () => {
    const cases = [
      {
        boardUrl: 'https://github.com/users/acme/projects/1',
        response: userProjectResponse,
        projectNodeId: 'PVT_123',
        statusFieldId: 'PVTF_456',
        statusOptions: [
          { id: 'PVTSSF_1', name: 'Unshaped' },
          { id: 'PVTSSF_2', name: 'Done' },
        ],
        ownerKey: 'user',
        number: '1',
      },
      {
        boardUrl: 'https://github.com/orgs/acme/projects/2',
        response: orgProjectResponse,
        projectNodeId: 'PVT_789',
        statusFieldId: 'PVTF_101',
        statusOptions: [{ id: 'PVTSSF_3', name: 'Building' }],
        ownerKey: 'organization',
        number: '2',
      },
    ];
    for (const c of cases) {
      const { transport, bodies } = fakeTransport([repoResponse, c.response]);
      const adapter = new GitHubAdapter(transport);

      const result = await adapter.fetchProjectIdentity({
        pm: 'github',
        repoUrl: 'https://github.com/acme/widgets',
        boardUrl: c.boardUrl,
      });

      expect(result, c.boardUrl).toEqual({
        repoUrl: 'https://github.com/acme/widgets',
        repoNodeId: 'R_kgDOAAAA',
        projectNodeId: c.projectNodeId,
        statusFieldId: c.statusFieldId,
        statusOptions: c.statusOptions,
      });
      expect(bodies[0]).toContain('repository');
      expect(bodies[0]).toContain('"owner":"acme"');
      expect(bodies[0]).toContain('"name":"widgets"');
      expect(bodies[1]).toContain(c.ownerKey);
      expect(bodies[1]).toContain('"login":"acme"');
      expect(bodies[1]).toContain(`"number":${c.number}`);
    }
  });

  it('maps a raw response onto the identity DTO', async () => {
    const { transport } = fakeTransport([repoResponse, userProjectResponse]);
    const adapter = new GitHubAdapter(transport);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    const result = await adapter.fetchProjectIdentity(data);

    expect(result).not.toBeNull();
    expect(result!.statusFieldId).toBe('PVTF_456');
    expect(result!.statusOptions).toHaveLength(2);
    expect(result!.statusOptions[0]).toEqual({
      id: 'PVTSSF_1',
      name: 'Unshaped',
    });
  });

  it('throws when the project has no Status field', async () => {
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

    const { transport } = fakeTransport([repoResponse, noStatus]);
    const adapter = new GitHubAdapter(transport);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    await expect(adapter.fetchProjectIdentity(data)).rejects.toThrow(/Status/);
  });

});

describe('PRJ-4 — a project payload is canonical at the boundary', () => {
  it('maps a ProjectV2 node onto the canonical ProjectData', async () => {
    const contentResponse = {
      status: 200,
      json: {
        data: {
          node: {
            id: 'PVT_123',
            title: 'Acme Widgets',
            closed: false,
            fields: {
              nodes: [
                {
                  id: 'PVTF_456',
                  name: 'Status',
                  options: [
                    { id: 'PVTSSF_1', name: 'Unshaped' },
                    { id: 'PVTSSF_2', name: 'Shipped' },
                  ],
                },
              ],
            },
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([contentResponse]);
    const adapter = new GitHubAdapter(transport);

    const project = await adapter.fetchProject(
      'https://github.com/acme/widgets',
      'PVT_123',
      'Shipped',
    );

    expect(project.name).toBe('Acme Widgets');
    expect(project.statusOptions).toEqual(['Unshaped', 'Shipped']);
    expect(project.doneLane).toBe('Shipped');
    expect(project.archivedAt).toBeNull();
    expect(project.mirrors).toEqual({
      github: 'https://github.com/acme/widgets',
    });
    expect(bodies[0]).toContain('ProjectContent');
    expect(bodies[0]).toContain('"projectId":"PVT_123"');
  });

  it('resolves a board-only identity without a repository (repo attach deferred)', async () => {
    const { transport, bodies } = fakeTransport([userProjectResponse]);
    const adapter = new GitHubAdapter(transport);

    const result = await adapter.fetchProjectIdentity({
      pm: 'github',
      repoUrl: '',
      boardUrl: 'https://github.com/users/acme/projects/1',
    });

    expect(result).toEqual({
      repoUrl: '',
      repoNodeId: '',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Unshaped' },
        { id: 'PVTSSF_2', name: 'Done' },
      ],
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('user');
  });

});

describe('PRJ-1 — the board is derived from the repository', () => {
  it('lists the repository node id and its linked boards', async () => {
    const repoBoardsResponse = {
      status: 200,
      json: {
        data: {
          repository: {
            id: 'R_kgDOAAAA',
            projectsV2: {
              nodes: [
                {
                  id: 'PVT_1',
                  title: 'widgets',
                  url: 'https://github.com/users/acme/projects/1',
                },
                {
                  id: 'PVT_2',
                  title: 'Roadmap',
                  url: 'https://github.com/users/acme/projects/2',
                },
              ],
            },
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([repoBoardsResponse]);
    const adapter = new GitHubAdapter(transport);

    const result = await adapter.fetchRepoBoards(
      'https://github.com/acme/widgets',
    );

    expect(result).toEqual({
      repoNodeId: 'R_kgDOAAAA',
      boards: [
        {
          projectNodeId: 'PVT_1',
          name: 'widgets',
          boardUrl: 'https://github.com/users/acme/projects/1',
        },
        {
          projectNodeId: 'PVT_2',
          name: 'Roadmap',
          boardUrl: 'https://github.com/users/acme/projects/2',
        },
      ],
    });
    expect(bodies[0]).toContain('RepoBoards');
    expect(bodies[0]).toContain('"owner":"acme"');
    expect(bodies[0]).toContain('"name":"widgets"');
  });

  it('creates, links and gives a Status field with the configured options', async () => {
    const repoResponse = {
      status: 200,
      json: { data: { repository: { id: 'R_kgDOAAAA' } } },
    };
    const viewerResponse = {
      status: 200,
      json: { data: { viewer: { id: 'U_kgDOAAAA' } } },
    };
    const createResponse = {
      status: 200,
      json: {
        data: {
          createProjectV2: {
            projectV2: {
              id: 'PVT_9',
              url: 'https://github.com/users/acme/projects/9',
            },
          },
        },
      },
    };
    const linkResponse = {
      status: 200,
      json: {
        data: {
          linkProjectV2ToRepository: { repository: { id: 'R_kgDOAAAA' } },
        },
      },
    };
    const fieldResponse = {
      status: 200,
      json: {
        data: {
          createProjectV2Field: {
            projectV2Field: {
              id: 'PVTF_9',
              name: 'Status',
              options: [
                { id: 'PVTSSF_1', name: 'Unshaped' },
                { id: 'PVTSSF_2', name: 'Shipped' },
              ],
            },
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([
      repoResponse,
      viewerResponse,
      createResponse,
      linkResponse,
      fieldResponse,
    ]);
    const adapter = new GitHubAdapter(transport);

    const board = await adapter.createBoardWithStatusField(
      'https://github.com/acme/widgets',
      ['Unshaped', 'Shipped'],
    );

    expect(board).toEqual({
      projectNodeId: 'PVT_9',
      boardUrl: 'https://github.com/users/acme/projects/9',
      statusFieldId: 'PVTF_9',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Unshaped' },
        { id: 'PVTSSF_2', name: 'Shipped' },
      ],
    });
    expect(bodies[0]).toContain('repository');
    expect(bodies[1]).toContain('viewer');
    expect(bodies[2]).toContain('createProjectV2');
    expect(bodies[2]).toContain('"title":"widgets"');
    expect(bodies[3]).toContain('linkProjectV2ToRepository');
    expect(bodies[3]).toContain('"repositoryId":"R_kgDOAAAA"');
    expect(bodies[4]).toContain('createProjectV2Field');
    expect(bodies[4]).toContain('"name":"Unshaped"');
  });

  it('lists the viewer boards as canonical ProjectData', async () => {
    const listResponse = {
      status: 200,
      json: {
        data: {
          viewer: {
            projectsV2: {
              nodes: [
                {
                  id: 'PVT_9',
                  title: 'Fresh Board',
                  url: 'https://github.com/users/acme/projects/9',
                  closed: false,
                  createdAt: '2026-10-02T09:00:00Z',
                  fields: {
                    nodes: [
                      {
                        id: 'PVTF_9',
                        name: 'Status',
                        options: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
                      },
                    ],
                  },
                  repositories: {
                    nodes: [
                      { url: 'https://github.com/acme/widgets' },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([listResponse]);
    const adapter = new GitHubAdapter(transport);

    const boards = await adapter.fetchViewerProjects();

    expect(boards).toHaveLength(1);
    expect(boards[0]!.project.name).toBe('Fresh Board');
    expect(boards[0]!.project.mirrors).toEqual({
      github: 'https://github.com/users/acme/projects/9',
    });
    expect(boards[0]!.project.createdAt).toBe('2026-10-02T09:00:00Z');
    expect(boards[0]!.project.statusOptions).toEqual(['Unshaped']);
    expect(boards[0]!.repoUrls).toEqual([
      'https://github.com/acme/widgets',
    ]);
    expect(bodies[0]).toContain('ViewerProjects');
  });

});

describe('MAT-3 — only typed issues are adopted', () => {
  it('creates the issue on the board with its type label', async () => {
    const repoResponse = {
      status: 200,
      json: { data: { repository: { id: 'R_kgDOAAAA' } } },
    };
    const labelResponse = {
      status: 200,
      json: { data: { repository: { label: { id: 'LA_1' } } } },
    };
    const createResponse = {
      status: 200,
      json: {
        data: {
          createIssue: {
            issue: {
              id: 'I_kwDOAAAA50',
              url: 'https://github.com/acme/widgets/issues/50',
            },
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([
      repoResponse,
      labelResponse,
      createResponse,
    ]);
    const adapter = new GitHubAdapter(transport);

    const handle = await adapter.createIssue(
      'https://github.com/acme/widgets',
      {
        title: 'Fix the bug',
        body: 'The bug.',
        type: 'bug',
        projectV2Ids: ['PVT_123'],
      },
    );

    expect(handle).toEqual({
      url: 'https://github.com/acme/widgets/issues/50',
      nodeId: 'I_kwDOAAAA50',
    });
    expect(bodies[0]).toContain('repository');
    expect(bodies[1]).toContain('label');
    expect(bodies[1]).toContain('"label":"type: bug"');
    expect(bodies[2]).toContain('CreateIssue');
    expect(bodies[2]).toContain('"labelIds":["LA_1"]');
    expect(bodies[2]).toContain('"projectV2Ids":["PVT_123"]');
  });

  it('creates an untyped issue without a label lookup', async () => {
    const repoResponse = {
      status: 200,
      json: { data: { repository: { id: 'R_kgDOAAAA' } } },
    };
    const createResponse = {
      status: 200,
      json: {
        data: {
          createIssue: {
            issue: {
              id: 'I_kwDOAAAA51',
              url: 'https://github.com/acme/widgets/issues/51',
            },
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([repoResponse, createResponse]);
    const adapter = new GitHubAdapter(transport);

    const handle = await adapter.createIssue(
      'https://github.com/acme/widgets',
      { title: 'Untyped', body: '', type: '', projectV2Ids: [] },
    );

    expect(handle).toEqual({
      url: 'https://github.com/acme/widgets/issues/51',
      nodeId: 'I_kwDOAAAA51',
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain('CreateIssue');
    expect(bodies[1]).toContain('"labelIds":[]');
  });

  it('creates a missing type label before creating the issue', async () => {
    const repoResponse = {
      status: 200,
      json: { data: { repository: { id: 'R_kgDOAAAA' } } },
    };
    const missingLabelResponse = {
      status: 200,
      json: { data: { repository: { label: null } } },
    };
    const createLabelResponse = { status: 201, json: { node_id: 'LA_new' } };
    const createResponse = {
      status: 200,
      json: {
        data: {
          createIssue: {
            issue: {
              id: 'I_kwDOAAAA52',
              url: 'https://github.com/acme/widgets/issues/52',
            },
          },
        },
      },
    };
    const { transport, bodies, paths } = fakeTransport([
      repoResponse,
      missingLabelResponse,
      createLabelResponse,
      createResponse,
    ]);
    const adapter = new GitHubAdapter(transport);

    await adapter.createIssue('https://github.com/acme/widgets', {
      title: 'Fix the bug',
      body: '',
      type: 'bug',
      projectV2Ids: ['PVT_123'],
    });

    expect(paths[0]).toBe('/repos/acme/widgets/labels');
    expect(bodies[2]).toContain('"name":"type: bug"');
    expect(bodies[3]).toContain('"labelIds":["LA_new"]');
  });

  it('throws when issue creation fails', async () => {
    const repoResponse = {
      status: 200,
      json: { data: { repository: { id: 'R_kgDOAAAA' } } },
    };
    const { transport } = fakeTransport([
      repoResponse,
      { status: 422, json: {} },
    ]);
    const adapter = new GitHubAdapter(transport);

    await expect(
      adapter.createIssue('https://github.com/acme/widgets', {
        title: 'Fix the bug',
        body: '',
        type: '',
        projectV2Ids: [],
      }),
    ).rejects.toThrow(/status 422/);
  });

  it('keeps issues carrying any type label — task, bug, chore, slice', async () => {
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

    const result = await adapter.fetchTrackedIssues(
      'https://github.com/acme/widgets',
    );

    expect(result.map((task) => task.url)).toEqual([
      'https://github.com/acme/widgets/issues/42',
      'https://github.com/acme/widgets/issues/43',
      'https://github.com/acme/widgets/issues/44',
      'https://github.com/acme/widgets/issues/45',
    ]);
    expect(result[0]).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      nodeId: 'I_kwDOAAAA42',
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state: 'open',
      createdAt: null,
      lastEditedAt: null,
      updatedAt: '2026-09-18T10:00:00Z',
      labels: ['type: task', 'bug'],
      parentUrl: null,
    });
    expect(
      result.some((task) => task.url.endsWith('/issues/46')),
    ).toBe(false);
    expect(paths[0]).toBe(
      '/repos/acme/widgets/issues?state=all&per_page=100&page=1',
    );
  });

  it('treats the legacy no-space type label as typed', async () => {
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

    const result = await adapter.fetchTrackedIssues(
      'https://github.com/acme/widgets',
    );

    expect(result.map((task) => task.url)).toEqual([
      'https://github.com/acme/widgets/issues/42',
    ]);
  });

  it('concatenates every page of tracked issues', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      issue(index + 1),
    );
    const secondPage = [issue(101), issue(102)];
    const { transport, paths } = fakeTransport([
      { status: 200, json: firstPage },
      { status: 200, json: secondPage },
    ]);
    const adapter = new GitHubAdapter(transport);

    const result = await adapter.fetchTrackedIssues(
      'https://github.com/acme/widgets',
    );

    expect(result.map((task) => Number(task.url.split('/').pop()))).toEqual(
      Array.from({ length: 102 }, (_, index) => index + 1),
    );
    expect(paths).toEqual([
      '/repos/acme/widgets/issues?state=all&per_page=100&page=1',
      '/repos/acme/widgets/issues?state=all&per_page=100&page=2',
    ]);
  });

});

describe('PRB-2 — a change the board clock cannot express is still seen', () => {
  it('reads the newest issue activity through a conditional request', async () => {
    const issuesResponse = {
      status: 200,
      json: [
        {
          number: 50,
          created_at: '2026-09-20T10:00:00Z',
          pull_request: { url: 'https://api.github.com/pulls/50' },
        },
        { number: 49, created_at: '2026-09-19T10:00:00Z' },
        { number: 48, created_at: '2026-09-18T10:00:00Z' },
      ],
      etag: 'W/"abc"',
    };
    const { transport, paths, etags } = fakeTransport([issuesResponse]);
    const adapter = new GitHubAdapter(transport);

    const result = await adapter.fetchLatestIssueActivity(
      'https://github.com/acme/widgets',
      'W/"old"',
    );

    expect(result).toEqual({
      changed: true,
      newestCreatedAt: '2026-09-19T10:00:00Z',
      etag: 'W/"abc"',
    });
    expect(paths[0]).toBe(
      '/repos/acme/widgets/issues?state=all&sort=created&direction=desc&per_page=10',
    );
    expect(etags[0]).toBe('W/"old"');
  });

  it('reports no change on a 304 without reading the body', async () => {
    const { transport } = fakeTransport([{ status: 304, json: {} }]);
    const adapter = new GitHubAdapter(transport);

    const result = await adapter.fetchLatestIssueActivity(
      'https://github.com/acme/widgets',
      'W/"abc"',
    );

    expect(result).toEqual({
      changed: false,
      newestCreatedAt: null,
      etag: null,
    });
  });

  it('reports a change with no cursor when no issue can supply one', async () => {
    const cases = [
      {
        name: 'only pull requests are newest',
        response: {
          status: 200,
          json: [
            { number: 50, created_at: '2026-09-20T10:00:00Z', pull_request: {} },
            { number: 49, created_at: '2026-09-19T10:00:00Z', pull_request: {} },
          ],
          etag: 'W/"abc"',
        },
      },
      {
        name: 'the repository has no issues',
        response: { status: 200, json: [], etag: 'W/"abc"' },
      },
    ];
    for (const { name, response } of cases) {
      const { transport } = fakeTransport([response]);
      const adapter = new GitHubAdapter(transport);

      const result = await adapter.fetchLatestIssueActivity(
        'https://github.com/acme/widgets',
      );

      expect(result, name).toEqual({
        changed: true,
        newestCreatedAt: null,
        etag: 'W/"abc"',
      });
    }
  });

  it('maps a closed issue to a closed task state', async () => {
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

    const result = await adapter.fetchTrackedIssues(
      'https://github.com/acme/widgets',
    );

    expect(result[0]!.state).toBe('closed');
  });

});

describe('SYNC-1 — issue content is written only when it differs', () => {
  it('fetches a single task by its issue url', async () => {
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

    const result = await adapter.fetchTask(
      'https://github.com/acme/widgets/issues/42',
    );

    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      nodeId: 'I_kwDOAAAA42',
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state: 'open',
      createdAt: null,
      lastEditedAt: null,
      updatedAt: '2026-09-18T10:00:00Z',
      labels: ['type: task'],
      parentUrl: null,
    });
    expect(paths[0]).toBe('/repos/acme/widgets/issues/42');
  });

  it('updates a task and returns the updated issue', async () => {
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

    const result = await adapter.updateTask(
      'https://github.com/acme/widgets/issues/42',
      {
        title: 'fix the widget',
        body: 'The bug now also happens on resize.',
      },
    );

    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      nodeId: 'I_kwDOAAAA42',
      title: 'fix the widget',
      body: 'The bug now also happens on resize.',
      state: 'open',
      createdAt: null,
      lastEditedAt: null,
      updatedAt: '2026-09-18T12:30:00Z',
      labels: ['type: task'],
      parentUrl: null,
    });
    expect(paths[0]).toBe('/repos/acme/widgets/issues/42');
    expect(bodies[0]).toBe(
      JSON.stringify({
        title: 'fix the widget',
        body: 'The bug now also happens on resize.',
      }),
    );
  });

  it('sets a task state and returns the updated issue', async () => {
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

    const result = await adapter.setTaskState(
      'https://github.com/acme/widgets/issues/42',
      'closed',
    );

    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/42',
      nodeId: 'I_kwDOAAAA42',
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state: 'closed',
      createdAt: null,
      lastEditedAt: null,
      updatedAt: '2026-09-18T12:30:00Z',
      labels: ['type: task'],
      parentUrl: null,
    });
    expect(paths[0]).toBe('/repos/acme/widgets/issues/42');
    expect(bodies[0]).toBe(JSON.stringify({ state: 'closed' }));
  });

});

describe('LANE-2 — board items carry their lane', () => {
  it('maps board items onto the DTO, distinguishing issues from draft cards', async () => {
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

    const result = await adapter.fetchBoardItems('PVT_123');

    expect(result).toEqual([
      {
        itemId: 'PVTI_1',
        type: 'ISSUE',
        issueUrl: 'https://github.com/acme/widgets/issues/42',
        statusOptionName: 'Done',
        updatedAt: null,
      },
      {
        itemId: 'PVTI_2',
        type: 'DRAFT_ISSUE',
        issueUrl: undefined,
        statusOptionName: undefined,
        updatedAt: null,
      },
    ]);
    expect(bodies[0]).toContain('BoardItems');
    expect(bodies[0]).toContain('"projectId":"PVT_123"');
  });

  it('maps draft card title and body onto the board item DTO', async () => {
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

    const result = await adapter.fetchBoardItems('PVT_123');

    expect(result).toEqual([
      {
        itemId: 'PVTI_2',
        type: 'DRAFT_ISSUE',
        draftTitle: 'An idea',
        draftBody: 'The draft body.',
        updatedAt: null,
      },
    ]);
    expect(bodies[0]).toContain('DraftIssue');
  });

  it('fetches the whole project detail in one query', async () => {
    const detailResponse = {
      status: 200,
      json: {
        data: {
          repository: {
            issues: {
              nodes: [
                {
                  url: 'https://github.com/acme/widgets/issues/42',
                  number: 42,
                  id: 'I_kwDOAAAA42',
                  title: 'Fix the Bug!',
                  body: 'The bug happens when the widget is resized.',
                  state: 'OPEN',
                  createdAt: '2026-09-18T08:00:00Z',
                  lastEditedAt: '2026-09-18T10:00:00Z',
                  updatedAt: '2026-09-18T11:30:00Z',
                  labels: { nodes: [{ name: 'type: task' }] },
                  parent: {
                    url: 'https://github.com/acme/widgets/issues/40',
                  },
                },
                {
                  url: 'https://github.com/acme/widgets/issues/43',
                  number: 43,
                  id: 'I_kwDOAAAA43',
                  title: 'Untyped',
                  body: 'No type label.',
                  state: 'CLOSED',
                  updatedAt: '2026-09-18T11:00:00Z',
                  labels: { nodes: [{ name: 'bug' }] },
                },
              ],
            },
          },
          node: {
            items: {
              nodes: [
                {
                  id: 'PVTI_1',
                  type: 'ISSUE',
                  updatedAt: '2026-09-18T12:00:00Z',
                  content: {
                    url: 'https://github.com/acme/widgets/issues/42',
                  },
                  fieldValues: {
                    nodes: [{ name: 'Building', field: { name: 'Status' } }],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([detailResponse]);
    const adapter = new GitHubAdapter(transport);

    const result = await adapter.fetchProjectDetail(
      'https://github.com/acme/widgets',
      'PVT_123',
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('ProjectDetail');
    expect(bodies[0]).toContain('"projectId":"PVT_123"');
    expect(bodies[0]).toContain('parent { url }');
    expect(result.issues).toEqual([
      {
        url: 'https://github.com/acme/widgets/issues/42',
        nodeId: 'I_kwDOAAAA42',
        title: 'Fix the Bug!',
        body: 'The bug happens when the widget is resized.',
        state: 'open',
        createdAt: '2026-09-18T08:00:00Z',
        lastEditedAt: '2026-09-18T10:00:00Z',
        updatedAt: '2026-09-18T11:30:00Z',
        labels: ['type: task'],
        parentUrl: 'https://github.com/acme/widgets/issues/40',
      },
    ]);
    expect(result.cards).toEqual([
      {
        itemId: 'PVTI_1',
        type: 'ISSUE',
        issueUrl: 'https://github.com/acme/widgets/issues/42',
        statusOptionName: 'Building',
        updatedAt: '2026-09-18T12:00:00Z',
      },
    ]);
  });

  it('maps a closed GraphQL issue to a closed task state', async () => {
    const detailResponse = {
      status: 200,
      json: {
        data: {
          repository: {
            issues: {
              nodes: [
                {
                  url: 'https://github.com/acme/widgets/issues/7',
                  number: 7,
                  id: 'I_kwDOAAAA7',
                  title: 'Close me',
                  body: 'Done.',
                  state: 'CLOSED',
                  updatedAt: '2026-09-18T09:00:00Z',
                  labels: { nodes: [{ name: 'type: task' }] },
                },
              ],
            },
          },
          node: { items: { nodes: [] } },
        },
      },
    };
    const { transport } = fakeTransport([detailResponse]);
    const adapter = new GitHubAdapter(transport);

    const result = await adapter.fetchProjectDetail(
      'https://github.com/acme/widgets',
      'PVT_123',
    );

    expect(result.issues[0]!.state).toBe('closed');
  });

});

describe('PRO-2 — a card without an issue is promoted', () => {
  it('promotes a draft card to an issue and fetches the full task', async () => {
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

    const result = await adapter.promoteCard('PVTI_2', 'R_kgDOAAAA');

    expect(result).toEqual({
      url: 'https://github.com/acme/widgets/issues/50',
      nodeId: 'I_kwDOAAAA50',
      title: 'An idea',
      body: 'The draft body.',
      state: 'open',
      createdAt: null,
      lastEditedAt: null,
      updatedAt: '2026-09-19T10:00:00Z',
      labels: [],
      parentUrl: null,
    });
    expect(bodies[0]).toContain('ConvertDraftIssue');
    expect(bodies[0]).toContain('"itemId":"PVTI_2"');
    expect(bodies[0]).toContain('"repositoryId":"R_kgDOAAAA"');
    expect(paths[0]).toBe('/repos/acme/widgets/issues/50');
  });

});

describe('LANE-2 — a lane move is written to the board', () => {
  it('sets a board item status via updateProjectV2ItemFieldValue', async () => {
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

    await adapter.setBoardStatus(
      new BoardStatusData({
        projectNodeId: 'PVT_123',
        statusFieldId: 'PVTF_456',
        issueUrl: 'https://github.com/acme/widgets/issues/42',
        statusOptionId: 'PVTSSF_3',
      }),
    );

    expect(bodies[1]).toContain('SetBoardStatus');
    expect(bodies[1]).toContain('"itemId":"PVTI_1"');
    expect(bodies[1]).toContain('"fieldId":"PVTF_456"');
    expect(bodies[1]).toContain('"optionId":"PVTSSF_3"');
  });

  it('adds an issue to the board via addProjectV2ItemById', async () => {
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

    await adapter.addBoardItem(
      'PVT_123',
      'https://github.com/acme/widgets/issues/42',
    );

    expect(bodies[0]).toContain('AddBoardItem');
    expect(bodies[0]).toContain('"contentId":"I_kwDOAAAA42"');
    expect(bodies[0]).toContain('"projectId":"PVT_123"');
  });

  it('deletes the issue card via deleteProjectV2Item', async () => {
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
      json: { data: { deleteProjectV2Item: { deletedItemId: 'PVTI_1' } } },
    };
    const { transport, bodies } = fakeTransport([
      boardResponse,
      mutationResponse,
    ]);
    const adapter = new GitHubAdapter(transport);

    await adapter.deleteCard(
      'PVT_123',
      'https://github.com/acme/widgets/issues/42',
    );

    expect(bodies[1]).toContain('DeleteBoardItem');
    expect(bodies[1]).toContain('"itemId":"PVTI_1"');
    expect(bodies[1]).toContain('"projectId":"PVT_123"');
  });

  it('treats a card-less issue as a no-op on delete', async () => {
    const boardResponse = {
      status: 200,
      json: { data: { node: { items: { nodes: [] } } } },
    };
    const { transport, bodies } = fakeTransport([boardResponse]);
    const adapter = new GitHubAdapter(transport);

    await adapter.deleteCard(
      'PVT_123',
      'https://github.com/acme/widgets/issues/42',
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('BoardItems');
  });

});

describe('PRO-1 — only untyped issues are promotion candidates', () => {
  it('lists open issues that carry no type label', async () => {
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

    const result = await adapter.fetchUnpromotedIssues(
      'https://github.com/acme/widgets',
    );

    expect(result).toEqual([
      {
        url: 'https://github.com/acme/widgets/issues/46',
        nodeId: 'I_kwDOAAAA46',
        title: 'An idea',
        body: 'No labels yet.',
        state: 'open',
        createdAt: null,
        lastEditedAt: null,
        updatedAt: '2026-09-18T14:00:00Z',
        labels: [],
        parentUrl: null,
      },
    ]);
    expect(paths[0]).toBe('/repos/acme/widgets/issues?state=open&per_page=100');
  });

  it('excludes issues carrying any type label from the unpromoted list', async () => {
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

    const result = await adapter.fetchUnpromotedIssues(
      'https://github.com/acme/widgets',
    );

    expect(result).toEqual([]);
  });

  it('adds a label to an issue via the labels endpoint', async () => {
    const labelsResponse = { status: 200, json: [{ name: 'type: task' }] };
    const { transport, paths, bodies } = fakeTransport([labelsResponse]);
    const adapter = new GitHubAdapter(transport);

    await adapter.addLabel(
      'https://github.com/acme/widgets/issues/42',
      'type: task',
    );

    expect(paths[0]).toBe('/repos/acme/widgets/issues/42/labels');
    expect(bodies[0]).toBe(JSON.stringify({ labels: ['type: task'] }));
  });

});

describe('adapter — a malformed url fails clearly', () => {
  it('reports an invalid repo or board url clearly instead of a TypeError', async () => {
    const repo = new GitHubAdapter(fakeTransport([]).transport);
    await expect(repo.fetchTrackedIssues('')).rejects.toThrow(
      /invalid repo url/,
    );

    const board = new GitHubAdapter(fakeTransport([]).transport);
    await expect(
      board.fetchProjectIdentity({
        pm: 'github',
        repoUrl: 'https://github.com/acme/widgets',
        boardUrl: '',
      }),
    ).rejects.toThrow(/invalid board url/);
  });

});

describe('ARC-1 — archiving closes the board', () => {
  it('closes and reopens a project via updateProjectV2', async () => {
    for (const closed of [true, false]) {
      const mutationResponse = {
        status: 200,
        json: { data: { updateProjectV2: { projectV2: { id: 'PVT_123' } } } },
      };
      const { transport, bodies } = fakeTransport([mutationResponse]);
      const adapter = new GitHubAdapter(transport);

      await adapter.setProjectClosed('PVT_123', closed);

      expect(bodies[0], `closed=${closed}`).toContain('SetProjectClosed');
      expect(bodies[0]).toContain('"projectId":"PVT_123"');
      expect(bodies[0]).toContain(`"closed":${closed}`);
    }
  });

  it('locks an issue conversation via lockLockable', async () => {
    const mutationResponse = {
      status: 200,
      json: {
        data: { lockLockable: { lockedRecord: { locked: true } } },
      },
    };
    const { transport, bodies } = fakeTransport([mutationResponse]);
    const adapter = new GitHubAdapter(transport);

    await adapter.lockIssue('I_kwDOAAAA42');

    expect(bodies[0]).toContain('lockLockable');
    expect(bodies[0]).toContain('lockableId: $nodeId');
    expect(bodies[0]).toContain('"nodeId":"I_kwDOAAAA42"');
    expect(bodies[0]).not.toContain('lockReason');
  });

});

describe('PRB-1 — a quiet board is probed cheaply', () => {
  it('probes every project in one aliased query, keyed by node id', async () => {
    const fleetResponse = {
      status: 200,
      json: {
        data: {
          p0: {
            id: 'PVT_1',
            updatedAt: '2026-09-18T10:00:00Z',
            closed: false,
          },
          p1: {
            id: 'PVT_2',
            updatedAt: '2026-09-18T11:00:00Z',
            closed: true,
          },
        },
      },
    };
    const { transport, bodies } = fakeTransport([fleetResponse]);
    const adapter = new GitHubAdapter(transport);

    const result = await adapter.fetchProjectStates(['PVT_1', 'PVT_2']);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('FleetState');
    expect(bodies[0]).toContain('p0: node(id: $id0)');
    expect(bodies[0]).toContain('p1: node(id: $id1)');
    expect(bodies[0]).toContain('ProjectV2');
    expect(bodies[0]).toContain('"id0":"PVT_1"');
    expect(bodies[0]).toContain('"id1":"PVT_2"');
    expect([...result.keys()]).toEqual(['PVT_1', 'PVT_2']);
    expect(result.get('PVT_1')).toEqual({
      projectId: 'PVT_1',
      updatedAt: '2026-09-18T10:00:00Z',
      closed: false,
    });
    expect(result.get('PVT_2')).toEqual({
      projectId: 'PVT_2',
      updatedAt: '2026-09-18T11:00:00Z',
      closed: true,
    });
  });

  it('issues no request when probing an empty project list', async () => {
    const { transport, bodies } = fakeTransport([]);
    const adapter = new GitHubAdapter(transport);

    const result = await adapter.fetchProjectStates([]);

    expect(result.size).toBe(0);
    expect(bodies).toHaveLength(0);
  });

  it('skips a missing or invalid node rather than failing the probe', async () => {
    const cases = [
      {
        name: 'a deleted project resolves to null',
        json: {
          data: {
            p0: null,
            p1: {
              id: 'PVT_2',
              updatedAt: '2026-09-18T11:00:00Z',
              closed: false,
            },
          },
        },
        ids: ['PVT_1', 'PVT_2'],
        expected: ['PVT_2'],
      },
      {
        name: 'an unusable node shape is dropped',
        json: { data: { p0: { id: 'PVT_1' } } },
        ids: ['PVT_1'],
        expected: [],
      },
    ];
    for (const { name, json, ids, expected } of cases) {
      const { transport } = fakeTransport([{ status: 200, json }]);
      const adapter = new GitHubAdapter(transport);

      const result = await adapter.fetchProjectStates(ids);

      expect([...result.keys()], name).toEqual(expected);
    }
  });
});

describe('SEED — repository labels are listed and created', () => {
  it('lists the repository label names', async () => {
    const labelsResponse = {
      status: 200,
      json: [{ name: 'type: task' }, { name: 'bug' }, { name: 42 }],
    };
    const { transport, paths } = fakeTransport([labelsResponse]);
    const adapter = new GitHubAdapter(transport);

    const labels = await adapter.listRepoLabels(
      'https://github.com/acme/widgets',
    );

    expect(labels).toEqual(['type: task', 'bug']);
    expect(paths[0]).toBe('/repos/acme/widgets/labels?per_page=100');
  });

  it('creates a repository label with the given color', async () => {
    const created = { status: 201, json: { name: 'type: bug' } };
    const { transport, paths, bodies } = fakeTransport([created]);
    const adapter = new GitHubAdapter(transport);

    await adapter.createRepoLabel(
      'https://github.com/acme/widgets',
      'type: bug',
      'ededed',
    );

    expect(paths[0]).toBe('/repos/acme/widgets/labels');
    expect(bodies[0]).toBe(
      JSON.stringify({ name: 'type: bug', color: 'ededed' }),
    );
  });
});
