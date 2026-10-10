import { describe, expect, it } from 'vitest';
import { CodeHostMirrorAdapter } from '../../../src/infrastructure/github/CodeHostMirrorAdapter.js';
import type { CodeHostTransport } from '../../../src/infrastructure/github/CodeHostTransport.js';

class FakeTransport implements CodeHostTransport {
  readonly bodies: string[] = [];
  private readonly routes: Record<string, unknown>;

  constructor(routes: Record<string, unknown>) {
    this.routes = routes;
  }

  async post(body: string): Promise<{ status: number; json: unknown }> {
    this.bodies.push(body);
    const parsed = JSON.parse(body) as { query: string };
    const key = Object.keys(this.routes).find((candidate) =>
      parsed.query.includes(candidate),
    );
    if (key === undefined) {
      throw new Error(`fake transport: no route for ${parsed.query}`);
    }
    return { status: 200, json: { data: this.routes[key] } };
  }
  async get(): Promise<never> {
    throw new Error('not used in this test');
  }
  async getConditional(): Promise<never> {
    throw new Error('not used in this test');
  }
  async patch(): Promise<never> {
    throw new Error('not used in this test');
  }
  async postPath(): Promise<never> {
    throw new Error('not used in this test');
  }
  async putPath(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const REPO_URL = 'https://github.com/acme/widgets';

describe('PSU-1 — the code host resolves a repository to its projects', () => {
  it('discovers the target handle and the projects the repository carries', async () => {
    const transport = new FakeTransport({
      RepoBoards: {
        repository: {
          id: 'R_1',
          projectsV2: {
            nodes: [{ id: 'PVT_1', title: 'widgets', url: 'board-url' }],
          },
        },
      },
    });
    const adapter = new CodeHostMirrorAdapter(transport);

    const discovery = await adapter.discoverProjects(REPO_URL);

    expect(discovery.targetHandle).toBe('R_1');
    expect(discovery.projects).toEqual([{ handle: 'PVT_1', name: 'widgets' }]);
  });

  it('reads the addressing a project writes through', async () => {
    const transport = new FakeTransport({
      ProjectFields: {
        node: {
          id: 'PVT_1',
          fields: {
            nodes: [
              {
                id: 'PVTF_1',
                name: 'Status',
                options: [{ id: 'O1', name: 'Todo' }],
              },
            ],
          },
        },
      },
    });
    const adapter = new CodeHostMirrorAdapter(transport);

    const addressing = await adapter.readProjectAddressing({
      handle: 'PVT_1',
      name: 'widgets',
    });

    expect(addressing).toEqual({
      projectHandle: 'PVT_1',
      statusFieldHandle: 'PVTF_1',
      statusOptions: [{ id: 'O1', name: 'Todo' }],
    });
  });

  it('returns null when the handle names no project', async () => {
    const transport = new FakeTransport({ ProjectFields: { node: {} } });
    const adapter = new CodeHostMirrorAdapter(transport);

    const addressing = await adapter.readProjectAddressing({
      handle: 'PVT_missing',
      name: 'widgets',
    });

    expect(addressing).toBeNull();
  });

  it('throws when the project carries no Status field', async () => {
    const transport = new FakeTransport({
      ProjectFields: { node: { id: 'PVT_1', fields: { nodes: [] } } },
    });
    const adapter = new CodeHostMirrorAdapter(transport);

    await expect(
      adapter.readProjectAddressing({ handle: 'PVT_1', name: 'widgets' }),
    ).rejects.toThrow(/Status/);
  });

  it('lists every project the viewer can see with its targets', async () => {
    const transport = new FakeTransport({
      ViewerBoards: {
        viewer: {
          projectsV2: {
            nodes: [
              {
                id: 'PVT_1',
                title: 'widgets',
                repositories: { nodes: [{ url: REPO_URL }] },
              },
              { id: 'PVT_2', title: 'orphan', repositories: { nodes: [] } },
            ],
          },
        },
      },
    });
    const adapter = new CodeHostMirrorAdapter(transport);

    const projects = await adapter.listProjects();

    expect(projects).toEqual([
      { project: { handle: 'PVT_1', name: 'widgets' }, targets: [REPO_URL] },
      { project: { handle: 'PVT_2', name: 'orphan' }, targets: [] },
    ]);
  });

  it('probes every project in one aliased query', async () => {
    const transport = new FakeTransport({
      ProjectStates: {
        p0: { id: 'PVT_1', updatedAt: '2026-09-18T10:00:00Z', closed: false },
        p1: { id: 'PVT_2', updatedAt: '2026-09-19T10:00:00Z', closed: true },
      },
    });
    const adapter = new CodeHostMirrorAdapter(transport);

    const states = await adapter.probeProjects(['PVT_1', 'PVT_2']);

    expect(states).toEqual([
      { handle: 'PVT_1', updatedAt: '2026-09-18T10:00:00Z', archived: false },
      { handle: 'PVT_2', updatedAt: '2026-09-19T10:00:00Z', archived: true },
    ]);
    expect(transport.bodies).toHaveLength(1);
  });

  it('probes nothing when no project has an identity', async () => {
    const transport = new FakeTransport({});
    const adapter = new CodeHostMirrorAdapter(transport);

    const states = await adapter.probeProjects([]);

    expect(states).toEqual([]);
    expect(transport.bodies).toEqual([]);
  });
});

describe('PSU-2 — the code host creates or adopts a project container', () => {
  it('adopts an existing project: links it and ensures its Status field', async () => {
    const transport = new FakeTransport({
      RepoNodeId: { repository: { id: 'R_1' } },
      ProjectFields: {
        node: {
          id: 'PVT_1',
          fields: {
            nodes: [
              {
                id: 'PVTF_1',
                name: 'Status',
                options: [{ id: 'O1', name: 'Todo' }],
              },
            ],
          },
        },
      },
      LinkBoard: { linkProjectV2ToRepository: { repository: { id: 'R_1' } } },
    });
    const adapter = new CodeHostMirrorAdapter(transport);

    const addressing = await adapter.adoptProject(
      REPO_URL,
      { handle: 'PVT_1', name: 'widgets' },
      ['Todo', 'Done'],
    );

    expect(addressing).toEqual({
      projectHandle: 'PVT_1',
      statusFieldHandle: 'PVTF_1',
      statusOptions: [{ id: 'O1', name: 'Todo' }],
    });
  });

  it('creates a project when none exists: links it and gives it the Status field', async () => {
    const transport = new FakeTransport({
      RepoNodeId: { repository: { id: 'R_1' } },
      ViewerBoards: { viewer: { projectsV2: { nodes: [] } } },
      Viewer: { viewer: { id: 'U_1' } },
      CreateBoard: {
        createProjectV2: { projectV2: { id: 'PVT_new', url: 'board-url' } },
      },
      LinkBoard: { linkProjectV2ToRepository: { repository: { id: 'R_1' } } },
      ProjectFields: { node: { id: 'PVT_new', fields: { nodes: [] } } },
      CreateStatusField: {
        createProjectV2Field: {
          projectV2Field: {
            id: 'PVTF_new',
            name: 'Status',
            options: [{ id: 'O1', name: 'Todo' }],
          },
        },
      },
    });
    const adapter = new CodeHostMirrorAdapter(transport);

    const addressing = await adapter.createProjectWithStatus(
      REPO_URL,
      'widgets',
      ['Todo', 'Done'],
    );

    expect(addressing).toEqual({
      projectHandle: 'PVT_new',
      statusFieldHandle: 'PVTF_new',
      statusOptions: [{ id: 'O1', name: 'Todo' }],
    });
  });
});
