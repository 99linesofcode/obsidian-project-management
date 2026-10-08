import { describe, expect, it } from 'vitest';
import { CodeHostMirrorAdapter } from '../../../src/infrastructure/github/CodeHostMirrorAdapter.js';
import type { CodeHostTransport } from '../../../src/infrastructure/github/CodeHostTransport.js';

const REPO_URL = 'https://github.com/acme/widgets';

class ViewerBoardsTransport implements CodeHostTransport {
  readonly bodies: string[] = [];

  async post(body: string): Promise<{ status: number; json: unknown }> {
    this.bodies.push(body);
    return {
      status: 200,
      json: {
        data: {
          viewer: {
            projectsV2: {
              nodes: [
                {
                  id: 'PVT_1',
                  title: 'Widgets',
                  createdAt: '2026-10-05T10:00:00Z',
                  repositories: { nodes: [{ url: REPO_URL }] },
                },
                {
                  id: 'PVT_2',
                  title: 'Orphan',
                  createdAt: '2026-10-04T10:00:00Z',
                  repositories: { nodes: [] },
                },
              ],
            },
          },
        },
      },
    };
  }

  async get(): Promise<never> {
    throw new Error('not used');
  }
  async patch(): Promise<never> {
    throw new Error('not used');
  }
  async postPath(): Promise<never> {
    throw new Error('not used');
  }
  async putPath(): Promise<never> {
    throw new Error('not used');
  }
}

describe('CodeHostMirrorAdapter — the project-capture surface', () => {
  it('enumerates the viewer boards with their linked repositories', async () => {
    const adapter = new CodeHostMirrorAdapter(new ViewerBoardsTransport());

    const projects = await adapter.captureProjects();

    expect(
      projects.map((project) => ({
        name: project.name,
        targets: project.targets,
        createdAt: project.createdAt,
      })),
    ).toEqual([
      { name: 'Widgets', targets: [REPO_URL], createdAt: '2026-10-05T10:00:00Z' },
      { name: 'Orphan', targets: [], createdAt: '2026-10-04T10:00:00Z' },
    ]);
  });
});
