import { describe, expect, it } from 'vitest';
import { AssembleProjectPassAction } from '../../../src/domain/actions/AssembleProjectPassAction.js';
import { AdapterRegistration } from '../../../src/domain/data/AdapterRegistration.js';
import { Baseline } from '../../../src/domain/data/Baseline.js';
import { CanonicalFieldWrite } from '../../../src/domain/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../../src/domain/data/CanonicalTask.js';
import { ConnectionEnvelope } from '../../../src/domain/data/ConnectionEnvelope.js';
import { DeclaredConnection } from '../../../src/domain/data/DeclaredConnection.js';
import { MirrorSide } from '../../../src/domain/data/MirrorSide.js';
import { MirrorSyncPass } from '../../../src/domain/data/MirrorSyncPass.js';
import { OriginObservation } from '../../../src/domain/data/OriginObservation.js';
import type { RegisteredAdapter } from '../../../src/domain/data/RegisteredAdapter.js';
import type { BaselineStorePort } from '../../../src/domain/ports/BaselineStorePort.js';
import type { MirrorAdapterFactoryPort } from '../../../src/domain/ports/MirrorAdapterFactoryPort.js';
import type { MirrorHandlePort } from '../../../src/domain/ports/MirrorHandlePort.js';
import type { OriginPort } from '../../../src/domain/ports/OriginPort.js';
import type { ProjectSourcePort } from '../../../src/domain/ports/ProjectSourcePort.js';
import { SideObservation } from '../../../src/domain/data/SideObservation.js';
import { MirrorSyncAction } from '../../../src/domain/actions/MirrorSyncAction.js';
import { registerAdapters } from '../../../src/domain/registerAdapters.js';
import { CodeHostMirrorAdapter } from '../../../src/infrastructure/github/CodeHostMirrorAdapter.js';
import type { CodeHostTransport } from '../../../src/infrastructure/github/CodeHostTransport.js';
import { githubDescriptor } from '../../../src/infrastructure/github/githubDescriptor.js';

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

  async getConditional(
    path: string,
    _etag?: string,
  ): Promise<{ status: number; json: unknown; etag?: string }> {
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
        value: 'type: task,bug',
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
  it('deletes the issue card from the board', async () => {
    const { adapter, transport } = adapterWith([
      boardResponse([issueNode()], [cardNode()]),
      {
        status: 200,
        json: { data: { deleteProjectV2Item: { deletedItemId: 'PVTI_1' } } },
      },
    ]);

    await adapter.deleteTask(ISSUE_URL);

    expect(transport.bodies[1]).toContain('DeleteBoardItem');
    expect(transport.bodies[1]).toContain('"itemId":"PVTI_1"');
    expect(transport.bodies[1]).toContain('"projectId":"PVT_123"');
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

  it('reads the newest issue activity, ignoring pull requests', async () => {
    const { adapter, transport } = adapterWith([
      {
        status: 200,
        json: [
          { created_at: '2026-09-25T10:00:00Z' },
          { created_at: '2026-09-24T10:00:00Z', pull_request: {} },
        ],
        etag: 'etag-2',
      },
    ]);

    const observation = await adapter.latestActivity(target(), 'etag-1');

    expect(transport.paths[0]).toBe(
      '/repos/acme/widgets/issues?state=all&sort=created&direction=desc&per_page=10',
    );
    expect(observation.changed).toBe(true);
    expect(observation.newestCreatedAt).toBe('2026-09-25T10:00:00Z');
    expect(observation.etag).toBe('etag-2');
  });

  it('reports no change when the conditional read answers 304', async () => {
    const { adapter } = adapterWith([{ status: 304, json: null }]);

    const observation = await adapter.latestActivity(target(), 'etag-1');

    expect(observation.changed).toBe(false);
    expect(observation.newestCreatedAt).toBeNull();
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

  it('reads the tracked (typed) issues for the board', async () => {
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

  it('captures the typed issues as tracked tasks', async () => {
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

describe('CodeHostMirrorAdapter — the board is derived from the repository (F02 NWM-2)', () => {
  it('prefers the registry identity over deriving from the repository', async () => {
    const transport = new FakeTransport([
      boardResponse([issueNode()], [cardNode()]),
    ]);
    const adapter = new CodeHostMirrorAdapter(
      transport,
      target(),
      async () => ({
        projectNodeId: 'PVT_123',
        statusFieldId: 'PVTF_456',
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
  it('reconciles a board it created in the same pass', async () => {
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
    const adapter = new CodeHostMirrorAdapter(transport, target(), undefined, [
      'Unshaped',
      'Done',
    ]);

    const before = await adapter.readProject(target());
    const created = await adapter.createProject(target(), 'widgets');
    const after = await adapter.readProject(target());

    expect(before).toBeNull();
    expect(created.handle).toBe(target());
    expect(after?.handle).toBe('PVT_NEW');
    expect(after?.archived).toBe(false);
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
    const adapter = new CodeHostMirrorAdapter(transport, target(), undefined, [
      'Unshaped',
    ]);

    await adapter.readProject(target());
    await adapter.createProject(target(), 'widgets');
    const after = await adapter.readProject(target());

    expect(transport.bodies.some((body) => body.includes('CreateBoard'))).toBe(
      false,
    );
    expect(transport.bodies.some((body) => body.includes('LinkBoard'))).toBe(
      true,
    );
    expect(after?.handle).toBe('PVT_ORPHAN');
  });
});

describe('githubDescriptor — registers with the core (F01 ACM-8, ACM-9)', () => {
  it('registers the code host as a mirror under the application id github', () => {
    const result = registerAdapters([
      new AdapterRegistration(
        githubDescriptor(),
        new CodeHostMirrorAdapter(new FakeTransport([]), target()),
      ),
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.adapters.get('github')?.descriptor.applicationId).toBe(
      'github',
    );
  });

  it('declares the universal and mandatory surface plus the optional mirrors', () => {
    const descriptor = githubDescriptor();

    expect(descriptor.capabilities).toContain('project');
    expect(descriptor.capabilities).toContain('lifecycle');
    expect(descriptor.capabilities).toContain('Status');
    expect(descriptor.capabilities).toContain('label');
    expect(descriptor.capabilities).toContain('subtasks');
    expect(descriptor.capabilities).toContain('completion');
    expect(descriptor.capabilities).toContain('capture');
    expect(descriptor.capabilities).toContain(
      'trustworthy per-field timestamps',
    );
    expect(descriptor.capabilities).toContain('complete-fetch');
    expect(descriptor.represents('Status')).toBe(true);
    expect(descriptor.represents('subtasks')).toBe(true);
  });
});

describe('MirrorSyncAction drives the code host through the ports (F02 NWM-3)', () => {
  it('reconciles a vault Status change onto the board lane', async () => {
    const transport = new FakeTransport([
      boardResponse([issueNode()], [cardNode()]),
      boardResponse([issueNode()], [cardNode()]),
      boardResponse([issueNode()], [cardNode()]),
      boardResponse([issueNode()], [cardNode()]),
      { status: 200, json: { data: { projectV2Item: { id: 'PVTI_1' } } } },
    ]);
    const adapter = new CodeHostMirrorAdapter(transport, target());
    const registered = registerAdapters([
      new AdapterRegistration(githubDescriptor(), adapter),
    ]).adapters.get('github')!;

    const pass = new MirrorSyncPass({
      entityId: ISSUE_URL,
      field: 'Status',
      origin: new SideObservation({
        side: 'vault',
        role: 'origin',
        current: 'Done',
        baseline: new Baseline('Building', false),
        fieldTime: null,
        timestampTrustworthy: true,
        completeFetch: true,
        currentCompleted: false,
      }),
      mirrors: [
        new MirrorSide({
          side: 'github',
          handle: ISSUE_URL,
          adapter: registered,
        }),
      ],
      baselines: new Map([['github', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction().invoke(pass);

    expect(record.result.value).toBe('Done');
    expect(record.written).toEqual(['github']);
    expect(transport.bodies[4]).toContain('SetBoardStatus');
    expect(transport.bodies[4]).toContain('"optionId":"PVTSSF_2"');
  });
});

class FieldOrigin implements OriginPort {
  readonly values = new Map<string, string | null>();
  readonly applied: CanonicalFieldWrite[] = [];

  async observe(_handle: string, field: string): Promise<OriginObservation> {
    return new OriginObservation({
      current: this.values.get(field) ?? null,
      currentCompleted: false,
      fieldTime: null,
      trustworthy: true,
    });
  }

  async readTask(): Promise<CanonicalTask | null> {
    return null;
  }

  async applyField(write: CanonicalFieldWrite): Promise<void> {
    this.applied.push(write);
  }

  async trash(): Promise<void> {}
}

class MemoryBaselines implements BaselineStorePort {
  private readonly baselines = new Map<string, Baseline>();

  async read(
    entityId: string,
    field: string,
    side: string,
  ): Promise<Baseline | null> {
    return this.baselines.get(`${entityId}\u0000${field}\u0000${side}`) ?? null;
  }

  async write(
    entityId: string,
    field: string,
    side: string,
    baseline: Baseline,
  ): Promise<void> {
    this.baselines.set(`${entityId}\u0000${field}\u0000${side}`, baseline);
  }
}

describe('AssembleProjectPassAction drives the code host through a resolved handle (F02 NWM-2, NWM-3)', () => {
  it('reads the issue by its resolved handle and reconciles its Status', async () => {
    const entityId = 'Projecten/Acme/taken/fix-the-bug.md';
    const transport = new FakeTransport(
      Array.from({ length: 30 }, () =>
        boardResponse([issueNode()], [cardNode()]),
      ),
    );
    const adapter = new CodeHostMirrorAdapter(transport, target());
    const registered = registerAdapters([
      new AdapterRegistration(githubDescriptor(), adapter),
    ]).adapters.get('github')!;

    const projectSource: ProjectSourcePort = {
      readConnections: async () => [
        new DeclaredConnection({
          slug: 'gh',
          envelope: new ConnectionEnvelope({
            application: 'github',
            target: target(),
          }),
        }),
      ],
      listEntities: async () => [entityId],
    };
    const origin = new FieldOrigin();
    origin.values.set('title', 'Fix the bug');
    origin.values.set('body', 'The bug happens on resize.');
    origin.values.set('completion', 'false');
    origin.values.set('Status', 'Todo');
    origin.values.set('label', 'type: task');
    origin.values.set('subtasks', PARENT_URL);
    const baselines = new MemoryBaselines();
    for (const [field, value] of origin.values) {
      await baselines.write(
        entityId,
        field,
        'origin',
        new Baseline(value, false),
      );
    }
    const mirrorAdapters: MirrorAdapterFactoryPort = {
      create: (application): RegisteredAdapter | null =>
        application === 'github' ? registered : null,
    };
    const handles: MirrorHandlePort = {
      resolve: async (connection, entity) =>
        connection === 'gh' && entity === entityId ? ISSUE_URL : null,
      list: async () => [],
      record: async () => {},
    };
    const action = new AssembleProjectPassAction(
      projectSource,
      origin,
      baselines,
      handles,
      mirrorAdapters,
    );

    const records = await action.invoke('Acme');
    const status = records.find((record) => record.field === 'Status')!;

    expect(status.result.value).toBe('Building');
    expect(status.result.winner).toBe('mirror:gh');
    expect(origin.applied).toEqual([
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
