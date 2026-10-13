import { describe, expect, it } from 'vitest';
import { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import { CanonicalProject } from '../../../../src/core/port/data/CanonicalProject.js';
import { CanonicalTask } from '../../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { ProjectAddressing } from '../../../../src/core/port/data/ProjectAddressing.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import { CodeHostMirrorAdapter } from '../../../../src/infrastructure/github/CodeHostMirrorAdapter.js';
import type { CodeHostTransport } from '../../../../src/infrastructure/github/CodeHostTransport.js';
import { TaskManagerMirrorAdapter } from '../../../../src/infrastructure/todoist/TaskManagerMirrorAdapter.js';
import type { TaskManagerTransport } from '../../../../src/infrastructure/todoist/TaskManagerTransport.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const PROJECT = 'Acme';
const CHILD = 'Projecten/Acme/taken/fix-the-bug.md';
const PARENT = 'Projecten/Acme/taken/parent-task.md';
const OTHER_PARENT = 'Projecten/Acme/taken/other-parent.md';
const PARENT_STEM = 'parent-task';
const CHILD_HANDLE = 'H_c';
const PARENT_HANDLE = 'T0';
const OTHER_HANDLE = 'T9';

const REPO_URL = 'https://github.com/acme/widgets';
const ISSUE_URL = 'https://github.com/acme/widgets/issues/42';
const REPO_ID = 'R_kgDOAAAA';

function connection(
  slug: string,
  application: string,
  target: string,
): ConnectionDataTransferObject {
  return new ConnectionDataTransferObject({ slug, application, target });
}

function todoTask(parent: string | null): CanonicalTask {
  return new CanonicalTask({
    handle: CHILD,
    entityId: CHILD,
    title: 'Fix the bug',
    body: 'Body text',
    status: '',
    completed: false,
    parent,
    labels: ['type:todo'],
  });
}

class TodoVault extends FakeVaultBase {
  constructor(
    private readonly task: CanonicalTask,
    private readonly connections: readonly ConnectionDataTransferObject[],
  ) {
    super();
  }

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return this.connections;
  }

  override async listEntities(): Promise<readonly string[]> {
    return [this.task.handle];
  }

  override async readTask(): Promise<CanonicalTask | null> {
    return this.task;
  }

  override async observe(
    _handle: string,
    field: string,
  ): Promise<OriginObservation> {
    return new OriginObservation({
      current: this.value(field),
      currentCompleted: this.task.completed,
      fieldTime: null,
      trustworthy: true,
    });
  }

  override async applyField(): Promise<void> {}

  override async trashNote(): Promise<void> {}

  private value(field: string): string | null {
    switch (field) {
      case 'title':
        return this.task.title;
      case 'body':
        return this.task.body;
      case 'Status':
        return this.task.status;
      case 'completion':
        return this.task.completed ? 'true' : 'false';
      case 'subtasks':
        return this.task.parent;
      case 'label':
        return JSON.stringify(this.task.labels);
      default:
        return null;
    }
  }
}

function issueNode(): Record<string, unknown> {
  return {
    url: ISSUE_URL,
    number: 42,
    id: 'I_1',
    title: 'Fix the bug',
    body: 'Body text',
    state: 'OPEN',
    createdAt: '2026-09-18T08:00:00Z',
    lastEditedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T11:30:00Z',
    labels: { nodes: [{ name: 'type:todo' }] },
    parent: { url: null },
  };
}

class RecordingCodeHostTransport implements CodeHostTransport {
  readonly bodies: string[] = [];
  readonly paths: string[] = [];

  async post(body: string): Promise<{ status: number; json: unknown }> {
    this.bodies.push(body);
    if (body.includes('RepoBoards')) {
      return {
        status: 200,
        json: {
          data: {
            repository: {
              id: REPO_ID,
              projectsV2: {
                nodes: [
                  {
                    id: 'PVT_1',
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
    if (body.includes('ProjectFields')) {
      return {
        status: 200,
        json: {
          data: {
            node: {
              id: 'PVT_1',
              fields: {
                nodes: [
                  {
                    id: 'PVTF_1',
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
    if (body.includes('RepoNodeId')) {
      return { status: 200, json: { data: { repository: { id: REPO_ID } } } };
    }
    if (body.includes('CreateIssue')) {
      return {
        status: 200,
        json: {
          data: { createIssue: { issue: { id: 'I_1', url: ISSUE_URL } } },
        },
      };
    }
    if (body.includes('ProjectDetail')) {
      return {
        status: 200,
        json: {
          data: {
            repository: { issues: { nodes: [issueNode()] } },
            node: { items: { nodes: [] } },
          },
        },
      };
    }
    return { status: 200, json: { data: {} } };
  }

  async get(path: string): Promise<{ status: number; json: unknown }> {
    this.paths.push(path);
    return { status: 200, json: { node_id: 'I_1' } };
  }

  async patch(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.paths.push(path);
    this.bodies.push(body);
    return { status: 200, json: {} };
  }

  async postPath(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.paths.push(path);
    this.bodies.push(body);
    return { status: 201, json: { node_id: 'LA_1' } };
  }

  async putPath(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.paths.push(path);
    this.bodies.push(body);
    return { status: 200, json: [] };
  }

  issueCreated(): boolean {
    return this.bodies.some((body) => body.includes('CreateIssue'));
  }
}

class RecordingTaskManagerTransport implements TaskManagerTransport {
  readonly calls: Array<{ method: string; path: string; body: string }> = [];

  constructor(private readonly parentHandle: string | null) {}

  async get(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'GET', path, body: '' });
    if (path.startsWith('/sections')) {
      return {
        status: 200,
        json: [{ id: 'S1', project_id: 'P1', name: 'Building' }],
      };
    }
    return { status: 200, json: this.taskNode() };
  }

  async post(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'POST', path, body });
    return { status: 200, json: this.taskNode() };
  }

  async delete(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'DELETE', path, body: '' });
    return { status: 204, json: null };
  }

  createdTaskBody(): string {
    const call = this.calls.find(
      (candidate) => candidate.method === 'POST' && candidate.path === '/tasks',
    );
    return call?.body ?? '';
  }

  private taskNode(): Record<string, unknown> {
    return {
      id: 'T1',
      project_id: 'P1',
      section_id: null,
      parent_id: this.parentHandle,
      content: 'Fix the bug',
      description: 'Body text',
      labels: ['type:todo'],
      checked: false,
      added_at: '2026-09-18T09:00:00Z',
      updated_at: '2026-09-18T10:00:00Z',
      completed_at: null,
    };
  }
}

async function registerParent(
  registry: FakeSyncState,
  notePath: string,
  handle: string,
): Promise<void> {
  await registry.setEntity({ id: notePath, notePath });
  await registry.setMirrorItem(PROJECT, 'todoist-main', handle, {
    entityId: notePath,
  });
}

describe('TDO-5 / ADP-3 — a type:todo is untracked on the code host', () => {
  it('creates no issue for a type:todo note', async () => {
    const transport = new RecordingCodeHostTransport();
    const adapter = new CodeHostMirrorAdapter(transport, REPO_URL);
    const vault = new TodoVault(todoTask(PARENT_STEM), [
      connection('gh-main', 'github', REPO_URL),
    ]);
    const action = new MirrorSyncAction(vault, new FakeSyncState(), {
      create: () => adapter,
    });

    await action.invoke(PROJECT);

    expect(transport.issueCreated()).toBe(false);
  });
});

describe('TDO-5 / ADP-6 — a type:todo materialises as a task-manager subtask', () => {
  it('creates a subtask under the parent handle, carrying type:todo', async () => {
    const transport = new RecordingTaskManagerTransport(PARENT_HANDLE);
    const adapter = new TaskManagerMirrorAdapter(transport, 'P1');
    const vault = new TodoVault(todoTask(PARENT_STEM), [
      connection('todoist-main', 'todoist', 'P1'),
    ]);
    const registry = new FakeSyncState();
    await registerParent(registry, PARENT, PARENT_HANDLE);
    const action = new MirrorSyncAction(vault, registry, {
      create: () => adapter,
    });

    await action.invoke(PROJECT);

    expect(transport.createdTaskBody()).toContain(
      `"parent_id":"${PARENT_HANDLE}"`,
    );
    expect(transport.createdTaskBody()).toContain('"labels":["type:todo"]');
  });
});

describe('SUB-3 — the parent relation is identity, not text', () => {
  it('settles a parent relation the origin and the mirror name alike (TDO-5, SUB-3)', async () => {
    const transport = new RecordingTaskManagerTransport(PARENT_HANDLE);
    const adapter = new TaskManagerMirrorAdapter(transport, 'P1');
    const vault = new TodoVault(todoTask(PARENT_STEM), [
      connection('todoist-main', 'todoist', 'P1'),
    ]);
    const registry = new FakeSyncState();
    await registry.setEntity({ id: CHILD, notePath: CHILD });
    await registry.setMirrorItem(PROJECT, 'todoist-main', CHILD_HANDLE, {
      entityId: CHILD,
    });
    await registerParent(registry, PARENT, PARENT_HANDLE);
    const action = new MirrorSyncAction(vault, registry, {
      create: () => adapter,
    });

    await action.invoke(PROJECT);
    const second = await action.invoke(PROJECT);
    const subtasks = second.find((record) => record.field === 'subtasks')!;

    expect(subtasks.written).toEqual([]);
    expect(subtasks.advanced).toEqual([]);
  });

  it('reports a delta when the origin and the mirror name a different parent', async () => {
    const transport = new RecordingTaskManagerTransport(OTHER_HANDLE);
    const adapter = new TaskManagerMirrorAdapter(transport, 'P1');
    const vault = new TodoVault(todoTask(PARENT_STEM), [
      connection('todoist-main', 'todoist', 'P1'),
    ]);
    const registry = new FakeSyncState();
    await registry.setEntity({ id: CHILD, notePath: CHILD });
    await registry.setMirrorItem(PROJECT, 'todoist-main', CHILD_HANDLE, {
      entityId: CHILD,
    });
    await registerParent(registry, PARENT, PARENT_HANDLE);
    await registerParent(registry, OTHER_PARENT, OTHER_HANDLE);
    const action = new MirrorSyncAction(vault, registry, {
      create: () => adapter,
    });

    const records = await action.invoke(PROJECT);
    const subtasks = records.find((record) => record.field === 'subtasks')!;

    expect(subtasks.result.outcome).not.toBe('unchanged');
  });
});

// A mirror that reports `materializesTodo` false under an application that is
// not a code host, so the port method alone decides whether a todo is tracked.
class UntrackingMirror implements MirrorPort {
  readonly createTaskCalls: string[] = [];

  async readProject(): Promise<CanonicalProject | null> {
    return null;
  }

  async resolveOrCreateProject(
    target: string,
    _name: string,
  ): Promise<ProjectAddressing | null> {
    return new ProjectAddressing({
      projectHandle: target,
      statusFieldHandle: '',
      statusOptions: [],
      effectiveTarget: target,
    });
  }

  async createProject(target: string, name: string): Promise<CanonicalProject> {
    return new CanonicalProject({ handle: target, name, archived: false });
  }

  async renameProject(): Promise<void> {}

  async setArchived(): Promise<void> {}

  async readTasks(): Promise<CanonicalTask[]> {
    return [];
  }

  async readTask(): Promise<CanonicalTask | null> {
    return null;
  }

  async createTask(
    _target: string,
    task: CanonicalTask,
  ): Promise<CanonicalTask> {
    this.createTaskCalls.push(task.handle);
    return task;
  }

  async applyField(): Promise<void> {}

  async deleteTask(): Promise<void> {}

  materializesTodo(): boolean {
    return false;
  }
}

describe('the port method alone decides todo tracking', () => {
  it('untracks a type:todo for a mirror reporting materializesTodo false, whatever its application', async () => {
    const mirror = new UntrackingMirror();
    const vault = new TodoVault(todoTask(PARENT_STEM), [
      connection('other-main', 'other', 'X'),
    ]);
    const action = new MirrorSyncAction(vault, new FakeSyncState(), {
      create: () => mirror,
    });

    await action.invoke(PROJECT);

    expect(mirror.createTaskCalls).toEqual([]);
  });
});
