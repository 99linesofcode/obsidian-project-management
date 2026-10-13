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

const viewer = { viewer: { id: 'U_1', login: 'acme' } };
const repoNode = { repository: { id: 'R_1' } };
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

const createBoard = {
  createProjectV2: { projectV2: { id: 'PVT_new', url: 'board' } },
};
const linkBoard = {
  linkProjectV2ToRepository: { repository: { id: 'R_1' } },
};

describe('CodeHostMirrorAdapter — resolveOrCreateProject', () => {
  it('creates a board under the repo, named for the project, when the target carries one and none exists', async () => {
    const transport = new FakeTransport([
      ['RepoBoards', repoBoards([])],
      ['ViewerBoards', viewerBoards([])],
      ['RepoNodeId', repoNode],
      ['Viewer', viewer],
      ['CreateBoard', createBoard],
      ['LinkBoard', linkBoard],
      ['ProjectFields', fieldsFor('PVT_new')],
    ]);

    const addressing = await new CodeHostMirrorAdapter(
      transport,
    ).resolveOrCreateProject(REPO_URL, 'widgets', ['Todo', 'Done']);

    expect(addressing?.projectHandle).toBe('PVT_new');
    expect(addressing?.effectiveTarget).toBe(REPO_URL);
    expect(transport.bodies.some((body) => body.includes('CreateBoard'))).toBe(
      true,
    );
  });

  it('adopts the board named for the project under the repo when it exists', async () => {
    const transport = new FakeTransport([
      ['RepoBoards', repoBoards([{ id: 'PVT_1', title: 'widgets' }])],
      ['RepoNodeId', repoNode],
      ['LinkBoard', linkBoard],
      ['ProjectFields', fieldsFor('PVT_1')],
    ]);

    const addressing = await new CodeHostMirrorAdapter(
      transport,
    ).resolveOrCreateProject(REPO_URL, 'widgets', ['Todo']);

    expect(addressing?.projectHandle).toBe('PVT_1');
    expect(addressing?.effectiveTarget).toBe(REPO_URL);
    expect(transport.bodies.some((body) => body.includes('CreateBoard'))).toBe(
      false,
    );
  });

  it('resolves an existing repo by name when the target is empty, then resolves-or-creates the board within it', async () => {
    const transport = new FakeTransport([
      ['RepoBoards', repoBoards([])],
      ['ViewerBoards', viewerBoards([])],
      ['RepoNodeId', repoNode],
      ['Viewer', viewer],
      ['CreateBoard', createBoard],
      ['LinkBoard', linkBoard],
      ['ProjectFields', fieldsFor('PVT_new')],
    ]);

    const addressing = await new CodeHostMirrorAdapter(
      transport,
    ).resolveOrCreateProject('', 'widgets', ['Todo']);

    expect(addressing?.projectHandle).toBe('PVT_new');
    expect(addressing?.effectiveTarget).toBe(REPO_URL);
  });

  it('never creates a repo: an absent repo leaves the connection unoriginated', async () => {
    const transport = new FakeTransport([
      ['Viewer', viewer],
      ['RepoNodeId', { repository: null }],
    ]);

    const addressing = await new CodeHostMirrorAdapter(
      transport,
    ).resolveOrCreateProject('', 'widgets', ['Todo']);

    expect(addressing).toBeNull();
    expect(
      transport.bodies.some(
        (body) => body.includes('CreateBoard') || body.includes('RepoBoards'),
      ),
    ).toBe(false);
  });
});
