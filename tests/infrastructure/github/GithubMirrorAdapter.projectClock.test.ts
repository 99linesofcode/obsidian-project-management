import { describe, expect, it } from 'vitest';
import { GithubMirrorAdapter } from '../../../src/infrastructure/github/GithubMirrorAdapter.js';
import type { GithubTransport } from '../../../src/infrastructure/github/GithubTransport.js';

// The port surface the archive fact's decisive time is read through. S22
// renames it from an archive-specific `archivedTime` to the project's own
// clock, `projectTime` (the approved rename). For the code host the value is
// still the board's archive-specific `closedAt` — null while the board is open.
interface ProjectClockPort {
  projectTime?(target: string): Promise<string | null>;
}

const REPO_URL = 'https://github.com/acme/widgets';

class FakeTransport implements GithubTransport {
  readonly bodies: string[] = [];
  private readonly responses: Array<{ status: number; json: unknown }>;
  private readonly derivation: Array<{ status: number; json: unknown }>;

  constructor(
    responses: Array<{ status: number; json: unknown }>,
    derivation: Array<{ status: number; json: unknown }> = [
      {
        status: 200,
        json: {
          data: {
            repository: {
              id: 'R_kgDOAAAA',
              projectsV2: {
                nodes: [{ id: 'PVT_123', title: 'widgets', url: '' }],
              },
            },
          },
        },
      },
      {
        status: 200,
        json: {
          data: {
            node: {
              id: 'PVT_123',
              fields: {
                nodes: [
                  {
                    id: 'PVTF_456',
                    name: 'Status',
                    options: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
                  },
                ],
              },
            },
          },
        },
      },
    ],
  ) {
    this.responses = [...responses];
    this.derivation = [...derivation];
  }

  async post(body: string): Promise<{ status: number; json: unknown }> {
    if (body.includes('RepoBoards') || body.includes('ProjectFields')) {
      return this.nextDerivation();
    }
    this.bodies.push(body);
    return this.next();
  }

  async get(): Promise<{ status: number; json: unknown }> {
    return this.next();
  }

  async patch(): Promise<{ status: number; json: unknown }> {
    return this.next();
  }

  async postPath(): Promise<{ status: number; json: unknown }> {
    return this.next();
  }

  async putPath(): Promise<{ status: number; json: unknown }> {
    return this.next();
  }

  private next(): { status: number; json: unknown } {
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error('fake transport: no more responses queued');
    }
    return response;
  }

  private nextDerivation(): { status: number; json: unknown } {
    const response = this.derivation.shift();
    if (response === undefined) {
      throw new Error('fake transport: no more derivation responses queued');
    }
    return response;
  }
}

function projectContent(
  closed: boolean,
  closedAt: string | null,
): { status: number; json: unknown } {
  return {
    status: 200,
    json: { data: { node: { id: 'PVT_123', closed, closedAt } } },
  };
}

function adapterWith(responses: Array<{ status: number; json: unknown }>): {
  adapter: GithubMirrorAdapter;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(responses);
  return { adapter: new GithubMirrorAdapter(transport, REPO_URL), transport };
}

describe('ADP-3 / NWM-6 — the code host reports closedAt through the project clock', () => {
  it('reports the board closedAt as the archive fact time when the board is closed', async () => {
    const { adapter } = adapterWith([
      projectContent(true, '2026-10-08T11:00:00Z'),
    ]);
    const port = adapter as unknown as ProjectClockPort;

    expect(await port.projectTime?.(REPO_URL)).toBe('2026-10-08T11:00:00Z');
  });

  it('reports null while the board is open, so it is decisive in the archive direction only', async () => {
    const { adapter } = adapterWith([projectContent(false, null)]);
    const port = adapter as unknown as ProjectClockPort;

    expect(await port.projectTime?.(REPO_URL)).toBeNull();
  });
});
