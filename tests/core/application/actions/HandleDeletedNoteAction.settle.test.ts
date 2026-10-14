import { describe, expect, it } from 'vitest';
import { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import { SweepDeletedNotesAction } from '../../../../src/core/application/actions/SweepDeletedNotesAction.js';
import type { CanonicalFieldWrite } from '../../../../src/core/port/data/CanonicalFieldWrite.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { GithubMirrorAdapter } from '../../../../src/infrastructure/github/GithubMirrorAdapter.js';
import type { GithubTransport } from '../../../../src/infrastructure/github/GithubTransport.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { entityRecord } from '../../../helpers/records.js';

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
const projectName = 'Acme Widgets';
const repoUrl = 'https://github.com/acme/widgets';

const connections = [
  { slug: 'github', application: 'github', target: repoUrl },
];

class GoneNoteVault extends FakeVaultBase {
  override async getNoteByPath(): Promise<null> {
    return null;
  }
}

// A mirror that hard-deletes the item: a completion write after the delete hits
// a gone item and throws — the code host's 404, and the task manager's.
class HardDeleteSurface {
  private readonly deleted = new Set<string>();
  readonly deletedHandles: string[] = [];
  readonly writes: CanonicalFieldWrite[] = [];

  async deleteTask(handle: string): Promise<void> {
    this.deleted.add(handle);
    this.deletedHandles.push(handle);
  }

  async applyField(write: CanonicalFieldWrite): Promise<void> {
    if (this.deleted.has(write.handle)) {
      throw new Error(`404: no item ${write.handle}`);
    }
    this.writes.push(write);
  }
}

class SurfaceAdapters implements MirrorAdapterFactoryPort {
  constructor(private readonly surface: HardDeleteSurface) {}

  create(): MirrorPort {
    return this.surface as unknown as MirrorPort;
  }
}

describe('a delete settles (NEW-1) — the completion write precedes the delete', () => {
  it('removes the mirror item, prunes the tombstone, and never re-attempts', async () => {
    const syncState = new FakeSyncState();
    syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
      github: { handle: url },
    });
    const surface = new HardDeleteSurface();
    const handleDeleted = new HandleDeletedNoteAction(
      syncState,
      new SurfaceAdapters(surface),
    );
    const sweep = new SweepDeletedNotesAction(
      new GoneNoteVault(),
      syncState,
      handleDeleted,
    );

    await sweep.execute({ projectName, connections });

    expect(surface.deletedHandles).toEqual([url]);
    expect(surface.writes).toHaveLength(1);
    expect(
      await syncState.findMirrorItemByEntity('github', 'uuid-42'),
    ).toBeNull();
    expect(await syncState.findTombstoneByNotePath(notePath)).not.toBeNull();

    await sweep.execute({ projectName, connections });

    expect(await syncState.findTombstoneByNotePath(notePath)).toBeNull();
    expect(await syncState.findByNotePath(notePath)).toBeNull();

    await sweep.execute({ projectName, connections });

    expect(surface.deletedHandles).toEqual([url]);
    expect(surface.writes).toHaveLength(1);
  });

  it('settles through the real code host adapter, completion before the issue delete', async () => {
    let disk: Record<string, unknown> = {};
    const registry = new SyncStateAdapter({
      async load() {
        return structuredClone(disk);
      },
      async save(next) {
        disk = structuredClone(next) as Record<string, unknown>;
      },
    });
    await registry.setEntity({ id: 'e1', notePath });
    await registry.setMirrorItem(projectName, 'github', url, {
      entityId: 'e1',
    });

    const transport = new StatefulGithubTransport();
    const factory: MirrorAdapterFactoryPort = {
      create: () => new GithubMirrorAdapter(transport, repoUrl),
    };
    const sweep = new SweepDeletedNotesAction(
      new GoneNoteVault(),
      registry,
      new HandleDeletedNoteAction(registry, factory),
    );

    await sweep.execute({ projectName, connections });

    expect(transport.calls).toEqual(['complete', 'deleteCard', 'deleteIssue']);
    expect(await registry.findMirrorItemByEntity('github', 'e1')).toBeNull();
    expect(await registry.findTombstoneByNotePath(notePath)).not.toBeNull();

    await sweep.execute({ projectName, connections });
    await sweep.execute({ projectName, connections });

    expect(await registry.getEntity('e1')).toBeNull();
    expect(await registry.findTombstone(url)).toBeNull();
    expect(transport.calls).toEqual(['complete', 'deleteCard', 'deleteIssue']);
  });
});

function repoBoards(): { status: number; json: unknown } {
  return {
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
  };
}

function projectFields(): { status: number; json: unknown } {
  return {
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
  };
}

function issueNode(): Record<string, unknown> {
  return {
    url,
    number: 42,
    id: 'I_kwDOAAAA42',
    title: 'Fix the bug',
    body: 'b',
    state: 'OPEN',
    createdAt: '2026-09-18T08:00:00Z',
    lastEditedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T11:30:00Z',
    labels: { nodes: [{ name: 'type: task' }] },
    parent: null,
  };
}

function cardNode(): Record<string, unknown> {
  return {
    id: 'PVTI_1',
    type: 'ISSUE',
    updatedAt: '2026-09-18T12:00:00Z',
    content: { url },
    fieldValues: { nodes: [] },
  };
}

function restIssue(): Record<string, unknown> {
  return {
    html_url: url,
    number: 42,
    node_id: 'I_kwDOAAAA42',
    title: 'Fix the bug',
    body: 'b',
    state: 'closed',
    updated_at: '2026-09-18T11:30:00Z',
    labels: [{ name: 'type: task' }],
  };
}

// The remote's real state: after the issue delete the issue and its card leave
// the listing, so a completion PATCH against it is a 404 — the reviewer's repro.
class StatefulGithubTransport implements GithubTransport {
  private deleted = false;
  readonly calls: string[] = [];

  async post(body: string): Promise<{ status: number; json: unknown }> {
    if (body.includes('RepoBoards')) return repoBoards();
    if (body.includes('ProjectFields')) return projectFields();
    if (body.includes('ProjectDetail')) {
      return {
        status: 200,
        json: {
          data: {
            repository: {
              issues: { nodes: this.deleted ? [] : [issueNode()] },
            },
            node: { items: { nodes: this.deleted ? [] : [cardNode()] } },
          },
        },
      };
    }
    if (body.includes('DeleteBoardItem')) {
      this.calls.push('deleteCard');
      return { status: 200, json: { data: { deleteProjectV2Item: {} } } };
    }
    if (body.includes('DeleteIssue')) {
      this.calls.push('deleteIssue');
      this.deleted = true;
      return { status: 200, json: { data: { deleteIssue: { issue: {} } } } };
    }
    throw new Error(`stateful transport: unexpected post ${body.slice(0, 40)}`);
  }

  async get(): Promise<{ status: number; json: unknown }> {
    return { status: 200, json: restIssue() };
  }

  async patch(): Promise<{ status: number; json: unknown }> {
    this.calls.push('complete');
    return this.deleted
      ? { status: 404, json: { message: 'Not Found' } }
      : { status: 200, json: restIssue() };
  }

  async postPath(): Promise<{ status: number; json: unknown }> {
    return { status: 200, json: {} };
  }

  async putPath(): Promise<{ status: number; json: unknown }> {
    return { status: 200, json: {} };
  }
}
