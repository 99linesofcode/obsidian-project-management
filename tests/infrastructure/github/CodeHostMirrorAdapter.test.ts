import { describe, expect, it } from 'vitest';
import { Baseline } from '../../../src/core/domain/Baseline.js';
import { CanonicalFieldWrite } from '../../../src/core/port/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../src/core/port/data/ConnectionDataTransferObject.js';
import { OriginObservation } from '../../../src/core/domain/OriginObservation.js';
import type { CanonicalField } from '../../../src/core/domain/canonicalField.js';
import type { MirrorPort } from '../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../src/core/port/MirrorAdapterFactoryPort.js';
import { FakeVault as FakeVaultBase } from '../../helpers/fakeVault.js';
import { MirrorSyncAction } from '../../../src/core/application/actions/MirrorSyncAction.js';
import { CodeHostMirrorAdapter } from '../../../src/infrastructure/github/CodeHostMirrorAdapter.js';
import type { CodeHostTransport } from '../../../src/infrastructure/github/CodeHostTransport.js';
import { SyncStateAdapter } from '../../../src/infrastructure/registry/SyncStateAdapter.js';

const ISSUE_URL = 'https://github.com/acme/widgets/issues/42';
const PARENT_URL = 'https://github.com/acme/widgets/issues/40';
const REPO_URL = 'https://github.com/acme/widgets';

function target(): string {
  return REPO_URL;
}

function repoBoardsResponse(): { status: number; json: unknown } {
  return {
    status: 200,
    json: {
      data: {
        repository: {
          id: 'R_kgDOAAAA',
          projectsV2: {
            nodes: [
              {
                id: 'PVT_123',
                title: 'widgets',
                url: 'https://github.com/orgs/acme/projects/1',
              },
            ],
          },
        },
      },
    },
  };
}

function projectFieldsResponse(): { status: number; json: unknown } {
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
  };
}

class FakeTransport implements CodeHostTransport {
  readonly bodies: string[] = [];
  readonly paths: string[] = [];
  readonly derivationBodies: string[] = [];
  private readonly responses: Array<{
    status: number;
    json: unknown;
    etag?: string;
  }>;
  private readonly derivation: Array<{ status: number; json: unknown }>;

  constructor(
    responses: Array<{ status: number; json: unknown; etag?: string }>,
    derivation: Array<{ status: number; json: unknown }> = [
      repoBoardsResponse(),
      projectFieldsResponse(),
    ],
  ) {
    this.responses = [...responses];
    this.derivation = [...derivation];
  }

  async post(body: string): Promise<{ status: number; json: unknown }> {
    if (body.includes('RepoBoards') || body.includes('ProjectFields')) {
      this.derivationBodies.push(body);
      return this.nextDerivation();
    }
    this.bodies.push(body);
    return this.next();
  }

  async get(path: string): Promise<{ status: number; json: unknown }> {
    this.paths.push(path);
    return this.next();
  }

  async patch(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.paths.push(path);
    this.bodies.push(body);
    return this.next();
  }

  async postPath(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.paths.push(path);
    this.bodies.push(body);
    return this.next();
  }

  async putPath(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.paths.push(path);
    this.bodies.push(body);
    return this.next();
  }

  private next(): { status: number; json: unknown; etag?: string } {
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

function issueNode(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    url: ISSUE_URL,
    number: 42,
    id: 'I_kwDOAAAA42',
    title: 'Fix the bug',
    body: 'The bug happens on resize.',
    state: 'OPEN',
    createdAt: '2026-09-18T08:00:00Z',
    lastEditedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T11:30:00Z',
    labels: { nodes: [{ name: 'type: task' }] },
    parent: { url: PARENT_URL },
    ...overrides,
  };
}

function cardNode(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'PVTI_1',
    type: 'ISSUE',
    updatedAt: '2026-09-18T12:00:00Z',
    content: { url: ISSUE_URL },
    fieldValues: {
      nodes: [{ name: 'Building', field: { name: 'Status' } }],
    },
    ...overrides,
  };
}

function boardResponse(
  issues: Record<string, unknown>[],
  cards: Record<string, unknown>[],
): { status: number; json: unknown } {
  return {
    status: 200,
    json: {
      data: {
        repository: { issues: { nodes: issues } },
        node: { items: { nodes: cards } },
      },
    },
  };
}

function restIssue(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    html_url: ISSUE_URL,
    number: 42,
    node_id: 'I_kwDOAAAA42',
    title: 'Fix the bug',
    body: 'The bug happens on resize.',
    state: 'open',
    updated_at: '2026-09-18T11:30:00Z',
    labels: [{ name: 'type: task' }],
    ...overrides,
  };
}

function adapterWith(
  responses: Array<{ status: number; json: unknown; etag?: string }>,
): {
  adapter: CodeHostMirrorAdapter;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(responses);
  return { adapter: new CodeHostMirrorAdapter(transport, target()), transport };
}

describe('CodeHostMirrorAdapter — the canonical read (F01 ACM-5)', () => {
  it('maps the issue and its board card onto the canonical task', async () => {
    const { adapter } = adapterWith([
      boardResponse([issueNode()], [cardNode()]),
    ]);

    const task = await adapter.readTask(ISSUE_URL);

    expect(task).not.toBeNull();
    expect(task!.handle).toBe(ISSUE_URL);
    expect(task!.title).toBe('Fix the bug');
    expect(task!.body).toBe('The bug happens on resize.');
    expect(task!.status).toBe('Building');
    expect(task!.completed).toBe(false);
    expect(task!.parent).toBe(PARENT_URL);
    expect(task!.labels).toEqual(['type: task']);
  });

  it('reads a closed issue as completion (the issue state, not the lane)', async () => {
    const { adapter } = adapterWith([
      boardResponse([issueNode({ state: 'CLOSED' })], [cardNode()]),
    ]);

    const task = await adapter.readTask(ISSUE_URL);

    expect(task!.completed).toBe(true);
    expect(task!.status).toBe('Building');
  });

  it('reads a card-less issue with no lane', async () => {
    const { adapter } = adapterWith([boardResponse([issueNode()], [])]);

    const task = await adapter.readTask(ISSUE_URL);

    expect(task!.status).toBe('');
  });

  it('returns null for a single issue without a type label (LBL-4)', async () => {
    const { adapter } = adapterWith([
      boardResponse(
        [issueNode({ labels: { nodes: [{ name: 'bug' }] } })],
        [cardNode()],
      ),
    ]);

    expect(await adapter.readTask(ISSUE_URL)).toBeNull();
  });
});

describe('CodeHostMirrorAdapter — the canonical writes (F01 ACM-5)', () => {
  it('writes a title through the issue REST endpoint', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: restIssue({ title: 'New title' }) },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: ISSUE_URL,
        field: 'title',
        value: 'New title',
      }),
    );

    expect(transport.paths[0]).toBe('/repos/acme/widgets/issues/42');
    expect(transport.bodies[0]).toBe(JSON.stringify({ title: 'New title' }));
  });

  it('writes a body through the issue REST endpoint', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: restIssue({ body: 'New body' }) },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: ISSUE_URL,
        field: 'body',
        value: 'New body',
      }),
    );

    expect(transport.bodies[0]).toBe(JSON.stringify({ body: 'New body' }));
  });

  it('writes completion through the issue state', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: restIssue({ state: 'closed' }) },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: ISSUE_URL,
        field: 'completion',
        value: 'true',
      }),
    );

    expect(transport.bodies[0]).toBe(JSON.stringify({ state: 'closed' }));
  });

  it('reopens an issue when completion is false', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: restIssue({ state: 'open' }) },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: ISSUE_URL,
        field: 'completion',
        value: 'false',
      }),
    );

    expect(transport.bodies[0]).toBe(JSON.stringify({ state: 'open' }));
  });

  it('writes Status as the board card lane', async () => {
    const { adapter, transport } = adapterWith([
      boardResponse([issueNode()], [cardNode()]),
      { status: 200, json: { data: { projectV2Item: { id: 'PVTI_1' } } } },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: ISSUE_URL,
        field: 'Status',
        value: 'Done',
      }),
    );

    expect(transport.bodies[1]).toContain('SetBoardStatus');
    expect(transport.bodies[1]).toContain('"itemId":"PVTI_1"');
    expect(transport.bodies[1]).toContain('"fieldId":"PVTF_456"');
    expect(transport.bodies[1]).toContain('"optionId":"PVTSSF_2"');
  });

  it('writes the label set through the issue labels endpoint', async () => {
    const { adapter, transport } = adapterWith([{ status: 200, json: [] }]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: ISSUE_URL,
        field: 'label',
        value: '["type: task","bug"]',
      }),
    );

    expect(transport.paths[0]).toBe('/repos/acme/widgets/issues/42/labels');
    expect(transport.bodies[0]).toBe(
      JSON.stringify({ labels: ['type: task', 'bug'] }),
    );
  });

  it('links a parent through the sub-issue relation', async () => {
    const { adapter, transport } = adapterWith([
      boardResponse([issueNode()], [cardNode()]),
      {
        status: 200,
        json: restIssue({ html_url: PARENT_URL, node_id: 'I_kwDOAAAA40' }),
      },
      {
        status: 200,
        json: { data: { addSubIssue: { issue: { id: 'I_kwDOAAAA42' } } } },
      },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: ISSUE_URL,
        field: 'subtasks',
        value: PARENT_URL,
      }),
    );

    expect(transport.bodies[1]).toContain('addSubIssue');
    expect(transport.bodies[1]).toContain('"issueId":"I_kwDOAAAA40"');
    expect(transport.bodies[1]).toContain('"subIssueId":"I_kwDOAAAA42"');
  });

  it('unlinks a parent through the sub-issue relation', async () => {
    const { adapter, transport } = adapterWith([
      boardResponse([issueNode()], [cardNode()]),
      {
        status: 200,
        json: restIssue({ html_url: PARENT_URL, node_id: 'I_kwDOAAAA40' }),
      },
      {
        status: 200,
        json: { data: { removeSubIssue: { issue: { id: 'I_kwDOAAAA42' } } } },
      },
    ]);

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle: ISSUE_URL,
        field: 'subtasks',
        value: null,
      }),
    );

    expect(transport.bodies[1]).toContain('removeSubIssue');
    expect(transport.bodies[1]).toContain('"subIssueId":"I_kwDOAAAA42"');
  });
});

describe('CodeHostMirrorAdapter — the remaining surface', () => {
  it('deletes the issue card and the issue from the board', async () => {
    const { adapter, transport } = adapterWith([
      boardResponse([issueNode()], [cardNode()]),
      {
        status: 200,
        json: { data: { deleteProjectV2Item: { deletedItemId: 'PVTI_1' } } },
      },
      {
        status: 200,
        json: { data: { deleteIssue: { issue: { id: 'I_kwDOAAAA42' } } } },
      },
    ]);

    await adapter.deleteTask(ISSUE_URL);

    expect(transport.bodies[1]).toContain('DeleteBoardItem');
    expect(transport.bodies[1]).toContain('"itemId":"PVTI_1"');
    expect(transport.bodies[1]).toContain('"projectId":"PVT_123"');
    expect(transport.bodies[2]).toContain('DeleteIssue');
    expect(transport.bodies[2]).toContain('"issueId":"I_kwDOAAAA42"');
  });

  it('deletes the issue even when it has no board card', async () => {
    const { adapter, transport } = adapterWith([
      boardResponse([issueNode()], []),
      {
        status: 200,
        json: { data: { deleteIssue: { issue: { id: 'I_kwDOAAAA42' } } } },
      },
    ]);

    await adapter.deleteTask(ISSUE_URL);

    expect(transport.bodies[1]).toContain('DeleteIssue');
    expect(transport.bodies[1]).toContain('"issueId":"I_kwDOAAAA42"');
  });

  it('reports a failed issue delete instead of leaving the issue behind', async () => {
    const { adapter } = adapterWith([
      boardResponse([issueNode()], [cardNode()]),
      {
        status: 200,
        json: { data: { deleteProjectV2Item: { deletedItemId: 'PVTI_1' } } },
      },
      { status: 403, json: { message: 'Resource not accessible' } },
    ]);

    await expect(adapter.deleteTask(ISSUE_URL)).rejects.toThrow(
      /GraphQL request failed with status 403/,
    );
  });

  it('renames the board through updateProjectV2', async () => {
    const { adapter, transport } = adapterWith([
      {
        status: 200,
        json: { data: { updateProjectV2: { projectV2: { id: 'PVT_123' } } } },
      },
    ]);

    await adapter.renameProject(target(), 'New Name');

    expect(transport.bodies[0]).toContain('RenameProject');
    expect(transport.bodies[0]).toContain('"title":"New Name"');
    expect(transport.bodies[0]).toContain('"projectId":"PVT_123"');
  });

  it('locks a task conversation through lockLockable', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: { node_id: 'I_kwDOAAAA42' } },
      {
        status: 200,
        json: { data: { lockLockable: { lockedRecord: { locked: true } } } },
      },
    ]);

    await adapter.lockTask(ISSUE_URL);

    expect(transport.paths[0]).toBe('/repos/acme/widgets/issues/42');
    expect(transport.bodies[0]).toContain('LockTask');
    expect(transport.bodies[0]).toContain('"nodeId":"I_kwDOAAAA42"');
  });

  it('unlocks a task conversation through unlockLockable', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: { node_id: 'I_kwDOAAAA42' } },
      {
        status: 200,
        json: {
          data: { unlockLockable: { unlockedRecord: { locked: false } } },
        },
      },
    ]);

    await adapter.unlockTask(ISSUE_URL);

    expect(transport.bodies[0]).toContain('UnlockTask');
    expect(transport.bodies[0]).toContain('"nodeId":"I_kwDOAAAA42"');
  });

  it('returns the decisive per-field time', async () => {
    const { adapter } = adapterWith([
      boardResponse([issueNode()], [cardNode()]),
    ]);
    const title = await adapter.fieldTime(ISSUE_URL, 'title');
    const { adapter: second } = adapterWith([
      boardResponse([issueNode()], [cardNode()]),
    ]);
    const status = await second.fieldTime(ISSUE_URL, 'Status');

    expect(title).toBe('2026-09-18T10:00:00Z');
    expect(status).toBe('2026-09-18T12:00:00Z');
  });

  it('reads only type-labelled issues for the board (LBL-4)', async () => {
    const { adapter } = adapterWith([
      boardResponse(
        [
          issueNode(),
          issueNode({
            url: 'https://github.com/acme/widgets/issues/43',
            number: 43,
            id: 'I_kwDOAAAA43',
            labels: { nodes: [{ name: 'bug' }] },
          }),
        ],
        [cardNode()],
      ),
    ]);

    const tasks = await adapter.readTasks(target());

    expect(tasks.map((task) => task.handle)).toEqual([ISSUE_URL]);
  });

  it('captures only type-labelled issues (LBL-6)', async () => {
    const { adapter } = adapterWith([
      boardResponse(
        [
          issueNode(),
          issueNode({
            url: 'https://github.com/acme/widgets/issues/43',
            number: 43,
            id: 'I_kwDOAAAA43',
            state: 'OPEN',
            labels: { nodes: [{ name: 'bug' }] },
          }),
          issueNode({
            url: 'https://github.com/acme/widgets/issues/44',
            number: 44,
            id: 'I_kwDOAAAA44',
            state: 'CLOSED',
            labels: { nodes: [{ name: 'type: chore' }] },
          }),
        ],
        [cardNode()],
      ),
    ]);

    const tasks = await adapter.capture(target());

    expect(tasks.map((task) => task.handle)).toEqual([
      ISSUE_URL,
      'https://github.com/acme/widgets/issues/44',
    ]);
  });

  it('reports the fetch as complete', () => {
    const { adapter } = adapterWith([]);

    expect(adapter.fetchComplete()).toBe(true);
  });

  it('creates an issue and returns its canonical task', async () => {
    const { adapter, transport } = adapterWith([
      { status: 200, json: { data: { repository: { id: 'R_kgDOAAAA' } } } },
      {
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
      },
    ]);

    const created = await adapter.createTask(
      target(),
      new CanonicalTask({
        handle: '',
        entityId: 'uuid-1',
        title: 'New task',
        body: 'Body',
        status: '',
        completed: false,
        parent: null,
        labels: [],
      }),
    );

    expect(transport.bodies[1]).toContain('CreateIssue');
    expect(transport.bodies[1]).toContain('"projectV2Ids":["PVT_123"]');
    expect(created.handle).toBe('https://github.com/acme/widgets/issues/50');
    expect(created.entityId).toBe('uuid-1');
  });
});

describe('CodeHostMirrorAdapter — the archive fact\'s decisive time (ADP-3)', () => {
  it('reports the board ProjectV2.closedAt as the archive decisive time', async () => {
    const { adapter } = adapterWith([
      {
        status: 200,
        json: {
          data: {
            node: {
              id: 'PVT_123',
              closed: true,
              closedAt: '2026-10-08T11:00:00Z',
            },
          },
        },
      },
    ]);

    expect(await adapter.projectTime(target())).toBe('2026-10-08T11:00:00Z');
  });

  it('reports null while the board is open', async () => {
    const { adapter } = adapterWith([
      {
        status: 200,
        json: {
          data: {
            node: { id: 'PVT_123', closed: false, closedAt: null },
          },
        },
      },
    ]);

    expect(await adapter.projectTime(target())).toBeNull();
  });
});

describe('CodeHostMirrorAdapter — the board is derived from the repository (F02 NWM-2)', () => {
  it('prefers the registry identity over deriving from the repository', async () => {
    const transport = new FakeTransport([
      boardResponse([issueNode()], [cardNode()]),
    ]);
    const adapter = new CodeHostMirrorAdapter(
      transport,
      target(),
      async () => ({
        target: target(),
        targetHandle: 'R_kgDOAAAA',
        projectHandle: 'PVT_123',
        statusFieldHandle: 'PVTF_456',
        statusOptions: [
          { id: 'PVTSSF_1', name: 'Unshaped' },
          { id: 'PVTSSF_2', name: 'Done' },
        ],
      }),
    );

    const task = await adapter.readTask(ISSUE_URL);

    expect(task!.status).toBe('Building');
    expect(transport.derivationBodies).toEqual([]);
  });

  it('throws a clear error when the repository has no board', async () => {
    const transport = new FakeTransport(
      [],
      [
        {
          status: 200,
          json: {
            data: {
              repository: { id: 'R_kgDOAAAA', projectsV2: { nodes: [] } },
            },
          },
        },
      ],
    );
    const adapter = new CodeHostMirrorAdapter(transport, target());

    await expect(adapter.readTask(ISSUE_URL)).rejects.toThrow(
      'repository widgets has no board',
    );
  });
});

describe('CodeHostMirrorAdapter — onboarding a missing board (F02 NWM-2)', () => {
  it('creates the board and its Status field with the given options when none exists', async () => {
    const transport = new FakeTransport(
      [
        { status: 200, json: { data: { repository: { id: 'R_kgDOAAAA' } } } },
        {
          status: 200,
          json: { data: { viewer: { projectsV2: { nodes: [] } } } },
        },
        { status: 200, json: { data: { viewer: { id: 'U_1' } } } },
        {
          status: 200,
          json: {
            data: {
              createProjectV2: {
                projectV2: { id: 'PVT_NEW', url: 'https://example.test/p' },
              },
            },
          },
        },
        {
          status: 200,
          json: {
            data: {
              linkProjectV2ToRepository: {
                repository: { id: 'R_kgDOAAAA' },
              },
            },
          },
        },
        {
          status: 200,
          json: {
            data: {
              createProjectV2Field: {
                projectV2Field: {
                  id: 'PVTF_NEW',
                  name: 'Status',
                  options: [
                    { id: 'PVTSSF_1', name: 'Unshaped' },
                    { id: 'PVTSSF_2', name: 'Done' },
                  ],
                },
              },
            },
          },
        },
        {
          status: 200,
          json: {
            data: { node: { id: 'PVT_NEW', title: 'widgets', closed: false } },
          },
        },
      ],
      [
        {
          status: 200,
          json: {
            data: {
              repository: { id: 'R_kgDOAAAA', projectsV2: { nodes: [] } },
            },
          },
        },
        {
          status: 200,
          json: { data: { node: { id: 'PVT_NEW', fields: { nodes: [] } } } },
        },
      ],
    );
    const adapter = new CodeHostMirrorAdapter(transport, target());

    const addressing = await adapter.resolveOrCreateProject(
      target(),
      'widgets',
      ['Unshaped', 'Done'],
    );

    expect(addressing?.projectHandle).toBe('PVT_NEW');
    expect(transport.bodies[5]).toContain('CreateStatusField');
    expect(transport.bodies[5]).toContain('"name":"Unshaped"');
    expect(transport.bodies[5]).toContain('"name":"Done"');
  });

  it('adopts an orphan board instead of creating a duplicate', async () => {
    const transport = new FakeTransport(
      [
        { status: 200, json: { data: { repository: { id: 'R_kgDOAAAA' } } } },
        {
          status: 200,
          json: {
            data: {
              viewer: {
                projectsV2: {
                  nodes: [
                    {
                      id: 'PVT_ORPHAN',
                      title: 'widgets',
                      repositories: { nodes: [] },
                    },
                  ],
                },
              },
            },
          },
        },
        {
          status: 200,
          json: {
            data: {
              linkProjectV2ToRepository: {
                repository: { id: 'R_kgDOAAAA' },
              },
            },
          },
        },
        {
          status: 200,
          json: {
            data: {
              createProjectV2Field: {
                projectV2Field: {
                  id: 'PVTF_ORPHAN',
                  name: 'Status',
                  options: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
                },
              },
            },
          },
        },
        {
          status: 200,
          json: {
            data: {
              node: { id: 'PVT_ORPHAN', title: 'widgets', closed: false },
            },
          },
        },
      ],
      [
        {
          status: 200,
          json: {
            data: {
              repository: { id: 'R_kgDOAAAA', projectsV2: { nodes: [] } },
            },
          },
        },
        {
          status: 200,
          json: {
            data: { node: { id: 'PVT_ORPHAN', fields: { nodes: [] } } },
          },
        },
      ],
    );
    const adapter = new CodeHostMirrorAdapter(transport, target());

    const addressing = await adapter.resolveOrCreateProject(target(), 'widgets', [
      'Unshaped',
    ]);

    expect(transport.bodies.some((body) => body.includes('CreateBoard'))).toBe(
      false,
    );
    expect(transport.bodies.some((body) => body.includes('LinkBoard'))).toBe(
      true,
    );
    expect(addressing?.projectHandle).toBe('PVT_ORPHAN');
  });
});

describe('MirrorSyncAction drives the code host through the ports (F02 NWM-3)', () => {
  it('reconciles a vault Status change onto the board lane', async () => {
    const emptyIssue = () =>
      issueNode({ title: '', body: '', labels: { nodes: [] }, parent: null });
    const transport = new FakeTransport(
      Array.from({ length: 40 }, () =>
        boardResponse([emptyIssue()], [cardNode()]),
      ),
    );
    const adapter = new CodeHostMirrorAdapter(transport, target());

    const vault = new FieldOrigin();
    vault.values.set('title', '');
    vault.values.set('body', '');
    vault.values.set('completion', 'false');
    vault.values.set('Status', 'Done');
    vault.values.set('label', '[]');
    const entityPath = 'Projecten/Acme/taken/fix-the-bug.md';
    let data: Record<string, unknown> = {};
    const registry = new SyncStateAdapter({
      async load() {
        return data;
      },
      async save(next: unknown) {
        data = next as Record<string, unknown>;
      },
    });
    await registry.setEntity({ id: entityPath, notePath: entityPath });
    await registry.setMirrorItem('Acme', 'gh', ISSUE_URL, {
      entityId: entityPath,
    });
    for (const field of ['title', 'body', 'completion', 'label'] as const) {
      const value = vault.values.get(field)!;
      await registry.writeBaseline(
        entityPath,
        field,
        'origin',
        new Baseline(value, false),
      );
      await registry.writeBaseline(
        entityPath,
        field,
        'mirror:gh',
        new Baseline(value, false),
      );
    }
    await registry.writeBaseline(
      entityPath,
      'Status',
      'origin',
      new Baseline('Building', false),
    );
    await registry.writeBaseline(
      entityPath,
      'Status',
      'mirror:gh',
      new Baseline('Building', false),
    );
    const action = new MirrorSyncAction(vault, registry, {
      create: () => adapter,
    });

    const records = await action.invoke('Acme');
    const status = records.find((record) => record.field === 'Status')!;

    expect(status.result.value).toBe('Done');
    expect(status.written).toEqual(['mirror:gh']);
    expect(
      transport.bodies.some(
        (body) =>
          body.includes('SetBoardStatus') &&
          body.includes('"optionId":"PVTSSF_2"'),
      ),
    ).toBe(true);
  });
});

class FieldOrigin extends FakeVaultBase {
  readonly values = new Map<string, string | null>();
  readonly applied: CanonicalFieldWrite[] = [];

  override async observe(
    _handle: string,
    field: string,
  ): Promise<OriginObservation> {
    return new OriginObservation({
      current: this.values.get(field) ?? null,
      currentCompleted: false,
      fieldTime: null,
      trustworthy: true,
    });
  }

  override async readTask(): Promise<CanonicalTask | null> {
    return null;
  }

  override async applyField(write: CanonicalFieldWrite): Promise<void> {
    this.applied.push(write);
  }

  override async trashNote(): Promise<void> {}

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return [
      new ConnectionDataTransferObject({
        slug: 'gh',
        application: 'github',
        target: target(),
      }),
    ];
  }

  override async listEntities(): Promise<readonly string[]> {
    return ['Projecten/Acme/taken/fix-the-bug.md'];
  }
}

describe('MirrorSyncAction drives the code host through a resolved handle (F02 NWM-2, NWM-3)', () => {
  it('reads the issue by its resolved handle and reconciles its Status', async () => {
    const entityId = 'Projecten/Acme/taken/fix-the-bug.md';
    const transport = new FakeTransport(
      Array.from({ length: 30 }, () =>
        boardResponse([issueNode()], [cardNode()]),
      ),
    );
    const adapter = new CodeHostMirrorAdapter(transport, target());

    const vault = new FieldOrigin();
    vault.values.set('title', 'Fix the bug');
    vault.values.set('body', 'The bug happens on resize.');
    vault.values.set('completion', 'false');
    vault.values.set('Status', 'Todo');
    vault.values.set('label', '["type: task"]');
    vault.values.set('subtasks', PARENT_URL);
    let data: Record<string, unknown> = {};
    const registry = new SyncStateAdapter({
      async load() {
        return data;
      },
      async save(next: unknown) {
        data = next as Record<string, unknown>;
      },
    });
    for (const [field, value] of vault.values) {
      await registry.writeBaseline(
        entityId,
        field as CanonicalField,
        'origin',
        new Baseline(value, false),
      );
    }
    await registry.setEntity({ id: entityId, notePath: entityId });
    await registry.setMirrorItem('Acme', 'gh', ISSUE_URL, { entityId });
    const mirrorAdapters: MirrorAdapterFactoryPort = {
      create: (application): MirrorPort | null =>
        application === 'github' ? adapter : null,
    };
    const action = new MirrorSyncAction(vault, registry, mirrorAdapters);

    const records = await action.invoke('Acme');
    const status = records.find((record) => record.field === 'Status')!;

    expect(status.result.value).toBe('Building');
    expect(status.result.winner).toBe('mirror:gh');
    expect(vault.applied).toEqual([
      new CanonicalFieldWrite({
        handle: entityId,
        field: 'Status',
        value: 'Building',
      }),
    ]);
    expect(
      transport.derivationBodies.some((body) => body.includes('RepoBoards')),
    ).toBe(true);
    expect(
      transport.derivationBodies.some((body) => body.includes('ProjectFields')),
    ).toBe(true);
  });
});
