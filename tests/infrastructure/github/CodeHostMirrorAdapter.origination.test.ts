import { describe, expect, it } from 'vitest';
import { CodeHostMirrorAdapter } from '../../../src/infrastructure/github/CodeHostMirrorAdapter.js';
import type { CodeHostTransport } from '../../../src/infrastructure/github/CodeHostTransport.js';

const REPO_URL = 'https://github.com/acme/widgets';

class FakeTransport implements CodeHostTransport {
  readonly bodies: string[] = [];
  private readonly routes: Array<[string, unknown]>;

  constructor(routes: Array<[string, unknown]>) {
    this.routes = routes;
  }

  async post(body: string): Promise<{ status: number; json: unknown }> {
    this.bodies.push(body);
    const parsed = JSON.parse(body) as { query: string };
    const route = this.routes.find(([key]) => parsed.query.includes(key));
    if (route === undefined) {
      throw new Error(`fake transport: no route for ${parsed.query}`);
    }
    return { status: 200, json: { data: route[1] } };
  }
  async get(): Promise<never> {
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

const statusField = {
  id: 'PVTF_1',
  name: 'Status',
  options: [{ id: 'O1', name: 'Todo' }],
};

function repoBoards(nodes: Array<{ id: string; title: string }>): unknown {
  return { repository: { id: 'R_1', projectsV2: { nodes } } };
}

function viewerBoards(nodes: Array<{ id: string; title: string }>): unknown {
  return { viewer: { projectsV2: { nodes } } };
}

function fieldsFor(projectId: string): unknown {
  return { node: { id: projectId, fields: { nodes: [statusField] } } };
}

describe('CodeHostMirrorAdapter — resolveOrCreateProject', () => {
  it('creates a board under the repo, named for the project, when the target carries one and none exists', async () => {
    const transport = new FakeTransport([
      ['RepoBoards', repoBoards([])],
      ['RepoNodeId', { repository: { id: 'R_1' } }],
      ['ViewerBoards', viewerBoards([])],
      ['Viewer', { viewer: { id: 'U_1' } }],
      [
        'CreateBoard',
        { createProjectV2: { projectV2: { id: 'PVT_new', url: 'board' } } },
      ],
      ['LinkBoard', { linkProjectV2ToRepository: { repository: { id: 'R_1' } } }],
      ['ProjectFields', fieldsFor('PVT_new')],
    ]);

    const addressing = await new CodeHostMirrorAdapter(
      transport,
    ).resolveOrCreateProject(REPO_URL, 'widgets', ['Todo', 'Done']);

    expect(addressing.projectHandle).toBe('PVT_new');
    expect(addressing.statusFieldHandle).toBe('PVTF_1');
    expect(transport.bodies.some((body) => body.includes('CreateBoard'))).toBe(
      true,
    );
  });

  it('adopts the board named for the project under the repo when it exists', async () => {
    const transport = new FakeTransport([
      ['RepoBoards', repoBoards([{ id: 'PVT_1', title: 'widgets' }])],
      ['RepoNodeId', { repository: { id: 'R_1' } }],
      ['LinkBoard', { linkProjectV2ToRepository: { repository: { id: 'R_1' } } }],
      ['ProjectFields', fieldsFor('PVT_1')],
    ]);

    const addressing = await new CodeHostMirrorAdapter(
      transport,
    ).resolveOrCreateProject(REPO_URL, 'widgets', ['Todo']);

    expect(addressing.projectHandle).toBe('PVT_1');
    expect(transport.bodies.some((body) => body.includes('CreateBoard'))).toBe(
      false,
    );
  });

  it('creates a viewer board by name when the target is empty', async () => {
    const transport = new FakeTransport([
      ['ViewerBoards', viewerBoards([])],
      ['Viewer', { viewer: { id: 'U_1' } }],
      [
        'CreateBoard',
        { createProjectV2: { projectV2: { id: 'PVT_new', url: 'board' } } },
      ],
      ['ProjectFields', fieldsFor('PVT_new')],
    ]);

    const addressing = await new CodeHostMirrorAdapter(
      transport,
    ).resolveOrCreateProject('', 'widgets', ['Todo']);

    expect(addressing.projectHandle).toBe('PVT_new');
    expect(
      transport.bodies.some(
        (body) => body.includes('RepoBoards') || body.includes('LinkBoard'),
      ),
    ).toBe(false);
  });

  it('adopts a viewer board by name when the target is empty and it exists', async () => {
    const transport = new FakeTransport([
      ['ViewerBoards', viewerBoards([{ id: 'PVT_9', title: 'widgets' }])],
      ['ProjectFields', fieldsFor('PVT_9')],
    ]);

    const addressing = await new CodeHostMirrorAdapter(
      transport,
    ).resolveOrCreateProject('', 'widgets', ['Todo']);

    expect(addressing.projectHandle).toBe('PVT_9');
    expect(transport.bodies.some((body) => body.includes('CreateBoard'))).toBe(
      false,
    );
  });
});
