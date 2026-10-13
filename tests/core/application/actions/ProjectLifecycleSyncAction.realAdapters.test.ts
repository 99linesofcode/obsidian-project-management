import { describe, expect, it, vi } from 'vitest';

const { TFile } = vi.hoisted(() => {
  class TFile {
    stat: { mtime: number };
    constructor(
      public path: string,
      public extension: string,
      stat?: { mtime: number },
    ) {
      this.stat = stat ?? { mtime: 0 };
    }
  }
  return { TFile };
});

vi.mock('obsidian', () => ({ TFile }));

type TFileInstance = InstanceType<typeof TFile>;

import type { App } from 'obsidian';
import { ProjectLifecycleSyncAction } from '../../../../src/core/application/actions/ProjectLifecycleSyncAction.js';
import { ReconcileProjectTaskLocksAction } from '../../../../src/core/application/actions/ReconcileProjectTaskLocksAction.js';
import { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import { SweepDeletedNotesAction } from '../../../../src/core/application/actions/SweepDeletedNotesAction.js';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { VaultPort } from '../../../../src/core/port/VaultPort.js';
import { CodeHostMirrorAdapter } from '../../../../src/infrastructure/github/CodeHostMirrorAdapter.js';
import type {
  CodeHostResponse,
  CodeHostTransport,
} from '../../../../src/infrastructure/github/CodeHostTransport.js';
import { TaskManagerMirrorAdapter } from '../../../../src/infrastructure/todoist/TaskManagerMirrorAdapter.js';
import type {
  TaskManagerResponse,
  TaskManagerTransport,
} from '../../../../src/infrastructure/todoist/TaskManagerTransport.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';
import { connectionsOf } from '../../../../src/infrastructure/vault/connectionsOf.js';
import { vaultAdapter } from '../../../helpers/vaultAdapter.js';

const PROJECT = 'Acme';
const ACTIVE_HOME = 'Projecten/Acme/_Acme.md';
const ARCHIVED_HOME = 'Archief/Acme/_Acme.md';
const TASK_PATH = 'Projecten/Acme/taken/fix-the-bug.md';
const MTIME = Date.parse('2026-10-08T10:00:00Z');
const GITHUB_TARGET = 'https://github.com/acme/widgets';
const TODOIST_TARGET = 'proj-1';
const ISSUE_URL = 'https://github.com/acme/widgets/issues/42';

function home(connections: ReadonlyArray<[string, string, string]>): string {
  const lines = ['---', 'type: project', 'connections:'];
  for (const [slug, tool, project] of connections) {
    lines.push(`  ${slug}:`, `    tool: ${tool}`, `    project: ${project}`);
  }
  lines.push('---');
  return lines.join('\n');
}

const MIXED_HOME = home([
  ['a', 'github', GITHUB_TARGET],
  ['b', 'todoist', TODOIST_TARGET],
]);
const GITHUB_ONLY_HOME = home([['a', 'github', GITHUB_TARGET]]);
const TODOIST_ONLY_HOME = home([['b', 'todoist', TODOIST_TARGET]]);
const TODOIST_MISSING_HOME = home([['b', 'todoist', 'proj-missing']]);

class FakeAppVault {
  private readonly notes = new Map<
    string,
    { content: string; mtime: number }
  >();

  readonly metadataCache = {
    getFileCache: (file: { path: string }) => ({
      frontmatter: {
        connections: connectionsOf(this.notes.get(file.path)?.content ?? ''),
      },
    }),
  };

  seed(path: string, content: string, mtime: number): void {
    this.notes.set(path, { content, mtime });
  }

  has(path: string): boolean {
    return this.notes.has(path);
  }

  getAbstractFileByPath(path: string): TFileInstance | null {
    const note = this.notes.get(path);
    if (note === undefined) {
      return null;
    }
    return new TFile(path, 'md', { mtime: note.mtime });
  }

  getMarkdownFiles(): TFileInstance[] {
    return [...this.notes.entries()].map(
      ([path, note]) => new TFile(path, 'md', { mtime: note.mtime }),
    );
  }

  getFiles(): TFileInstance[] {
    return this.getMarkdownFiles();
  }

  getFolderByPath(): object | null {
    return {};
  }

  async createFolder(): Promise<void> {}

  async read(file: TFileInstance): Promise<string> {
    return this.notes.get(file.path)!.content;
  }

  async create(path: string, content: string): Promise<void> {
    this.notes.set(path, { content, mtime: Date.now() });
  }

  async modify(file: TFileInstance, content: string): Promise<void> {
    this.notes.set(file.path, { content, mtime: Date.now() });
  }

  rename(from: string, to: string): void {
    const note = this.notes.get(from);
    if (note === undefined) {
      return;
    }
    this.notes.delete(from);
    this.notes.set(to, note);
  }
}

class FakeFileManager {
  constructor(private readonly vault: FakeAppVault) {}

  async renameFile(file: TFileInstance, newPath: string): Promise<void> {
    this.vault.rename(file.path, newPath);
  }

  async trashFile(file: TFileInstance): Promise<void> {
    this.vault.rename(file.path, `${file.path}.trashed`);
  }
}

function memoryStorage() {
  let data: Record<string, unknown> = {};
  return {
    async load() {
      return data;
    },
    async save(next: unknown) {
      data = next as Record<string, unknown>;
    },
  };
}

function appFor(appVault: FakeAppVault): App {
  return {
    vault: appVault,
    fileManager: new FakeFileManager(appVault),
    metadataCache: appVault.metadataCache,
  } as unknown as App;
}

interface FakeIssue {
  url: string;
  nodeId: string;
  number: number;
  state: 'OPEN' | 'CLOSED';
  locked: boolean;
}

function ok(data: Record<string, unknown>): CodeHostResponse {
  return { status: 200, json: { data } };
}

interface FakeBoard {
  id: string;
  title: string;
  closed: boolean;
  closedAt: string | null;
  updatedAt: string;
}

class StatefulCodeHost implements CodeHostTransport {
  board: FakeBoard | null;
  readonly issues = new Map<string, FakeIssue>();
  readonly calls: string[] = [];
  readonly failLockFor = new Set<string>();
  readonly repoId = 'R_repo';
  readonly viewerId = 'U_viewer';
  readonly viewerLogin = 'acme';

  constructor(
    init: {
      boardTitle?: string;
      archived?: boolean;
      board?: 'present' | 'absent';
      closedAt?: string | null;
      updatedAt?: string;
    } = {},
  ) {
    const archived = init.archived ?? false;
    this.board =
      init.board === 'absent'
        ? null
        : {
            id: 'PVT_1',
            title: init.boardTitle ?? PROJECT,
            closed: archived,
            closedAt:
              init.closedAt !== undefined
                ? init.closedAt
                : archived
                  ? '2026-10-08T11:00:00Z'
                  : null,
            updatedAt: init.updatedAt ?? '2026-10-08T09:00:00Z',
          };
  }

  addIssue(partial: {
    url: string;
    nodeId: string;
    number: number;
    state?: 'OPEN' | 'CLOSED';
  }): FakeIssue {
    const issue: FakeIssue = {
      url: partial.url,
      nodeId: partial.nodeId,
      number: partial.number,
      state: partial.state ?? 'OPEN',
      locked: false,
    };
    this.issues.set(issue.url, issue);
    return issue;
  }

  async post(body: string): Promise<CodeHostResponse> {
    const parsed = JSON.parse(body) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const query = parsed.query;
    const variables = parsed.variables ?? {};

    if (query.includes('RepoBoards')) {
      const nodes =
        this.board === null
          ? []
          : [{ id: this.board.id, title: this.board.title, url: '' }];
      return ok({ repository: { id: this.repoId, projectsV2: { nodes } } });
    }
    if (query.includes('ProjectFields')) {
      return ok({
        node: {
          id: this.board?.id ?? 'PVT_1',
          fields: {
            nodes: [
              {
                id: 'PVTF_status',
                name: 'Status',
                options: [
                  { id: 'opt-todo', name: 'Todo' },
                  { id: 'opt-done', name: 'Done' },
                ],
              },
            ],
          },
        },
      });
    }
    if (query.includes('ProjectContent')) {
      if (this.board === null) {
        return ok({ node: null });
      }
      return ok({
        node: {
          id: this.board.id,
          title: this.board.title,
          closed: this.board.closed,
          closedAt: this.board.closedAt,
          updatedAt: this.board.updatedAt,
        },
      });
    }
    if (query.includes('SetProjectClosed')) {
      const closed = variables.closed === true;
      if (this.board !== null) {
        this.board.closed = closed;
        this.board.closedAt = closed ? '2026-10-08T12:00:00Z' : null;
      }
      this.calls.push(closed ? 'setArchived:true' : 'setArchived:false');
      return ok({
        updateProjectV2: { projectV2: { id: this.board?.id ?? 'PVT_1' } },
      });
    }
    if (query.includes('RenameProject')) {
      const title = String(variables.title ?? '');
      if (this.board !== null) {
        this.board.title = title;
      }
      this.calls.push(`rename:${title}`);
      return ok({
        updateProjectV2: { projectV2: { id: this.board?.id ?? 'PVT_1' } },
      });
    }
    if (query.includes('LockTask') || query.includes('UnlockTask')) {
      const nodeId = String(variables.nodeId ?? '');
      if (this.failLockFor.has(nodeId)) {
        return { status: 500, json: {} };
      }
      const lock = query.includes('LockTask');
      for (const issue of this.issues.values()) {
        if (issue.nodeId === nodeId) {
          issue.locked = lock;
        }
      }
      this.calls.push(lock ? 'lock' : 'unlock');
      return ok(
        lock
          ? { lockLockable: { lockedRecord: { locked: true } } }
          : { unlockLockable: { unlockedRecord: { locked: false } } },
      );
    }
    if (query.includes('ViewerBoards')) {
      return ok({ viewer: { projectsV2: { nodes: [] } } });
    }
    if (query.includes('Viewer')) {
      return ok({ viewer: { id: this.viewerId, login: this.viewerLogin } });
    }
    if (query.includes('RepoNodeId')) {
      return ok({ repository: { id: this.repoId } });
    }
    if (query.includes('CreateBoard')) {
      const title = String(variables.title ?? '');
      this.board = {
        id: 'PVT_created',
        title,
        closed: false,
        closedAt: null,
        updatedAt: '2026-10-08T09:00:00Z',
      };
      return ok({
        createProjectV2: { projectV2: { id: 'PVT_created', url: '' } },
      });
    }
    if (query.includes('LinkBoard')) {
      return ok({
        linkProjectV2ToRepository: { repository: { id: this.repoId } },
      });
    }
    if (query.includes('CreateStatusField')) {
      return ok({
        createProjectV2Field: {
          projectV2Field: {
            id: 'PVTF_status',
            options: [
              { id: 'opt-todo', name: 'Todo' },
              { id: 'opt-done', name: 'Done' },
            ],
          },
        },
      });
    }
    throw new Error(
      `stateful code host: unexpected query ${query.slice(0, 60)}`,
    );
  }

  async get(path: string): Promise<CodeHostResponse> {
    this.calls.push(`get:${path}`);
    const issue = [...this.issues.values()].find((candidate) =>
      path.endsWith(`/issues/${candidate.number}`),
    );
    if (issue === undefined) {
      return { status: 404, json: {} };
    }
    return {
      status: 200,
      json: { node_id: issue.nodeId, number: issue.number },
    };
  }

  async patch(path: string, _body: string): Promise<CodeHostResponse> {
    this.calls.push(`patch:${path}`);
    return { status: 200, json: {} };
  }

  async postPath(path: string, _body: string): Promise<CodeHostResponse> {
    this.calls.push(`postPath:${path}`);
    return { status: 200, json: {} };
  }

  async putPath(path: string, _body: string): Promise<CodeHostResponse> {
    this.calls.push(`putPath:${path}`);
    return { status: 200, json: {} };
  }
}

interface FakeProject {
  id: string;
  name: string;
  is_archived: boolean;
}

class StatefulTaskManager implements TaskManagerTransport {
  readonly projects = new Map<string, FakeProject>();
  readonly calls: string[] = [];
  readonly failArchiveFor = new Set<string>();

  constructor(init: { id?: string; name?: string; archived?: boolean } = {}) {
    const id = init.id ?? TODOIST_TARGET;
    this.projects.set(id, {
      id,
      name: init.name ?? PROJECT,
      is_archived: init.archived ?? false,
    });
  }

  async get(path: string): Promise<TaskManagerResponse> {
    const project = /^\/projects\/([^/?]+)$/.exec(path);
    if (project !== null) {
      const found = this.projects.get(decodeURIComponent(project[1]!));
      if (found === undefined) {
        return { status: 404, json: {} };
      }
      return {
        status: 200,
        json: {
          id: found.id,
          name: found.name,
          is_archived: found.is_archived,
        },
      };
    }
    if (path === '/projects') {
      return { status: 200, json: { results: [...this.projects.values()] } };
    }
    if (path.startsWith('/sections') || path.startsWith('/tasks')) {
      return { status: 200, json: { results: [] } };
    }
    return { status: 404, json: {} };
  }

  async post(path: string, body: string): Promise<TaskManagerResponse> {
    const archive = /^\/projects\/([^/?]+)\/(archive|unarchive)$/.exec(path);
    if (archive !== null) {
      const id = archive[1]!;
      if (this.failArchiveFor.has(id)) {
        return { status: 500, json: {} };
      }
      const project = this.projects.get(id);
      if (project !== undefined) {
        project.is_archived = archive[2] === 'archive';
      }
      this.calls.push(`${archive[2]}:${id}`);
      return { status: 200, json: {} };
    }
    const rename = /^\/projects\/([^/?]+)$/.exec(path);
    if (rename !== null) {
      const id = rename[1]!;
      const name = (JSON.parse(body) as { name?: string }).name ?? '';
      const project = this.projects.get(id);
      if (project !== undefined) {
        project.name = name;
      }
      this.calls.push(`rename:${id}:${name}`);
      return { status: 200, json: { id, name } };
    }
    if (path === '/projects') {
      const name = (JSON.parse(body) as { name?: string }).name ?? '';
      const id = `proj-${this.projects.size + 1}`;
      this.projects.set(id, { id, name, is_archived: false });
      this.calls.push(`create:${id}`);
      return { status: 200, json: { id, name, is_archived: false } };
    }
    return { status: 200, json: {} };
  }

  async delete(_path: string): Promise<TaskManagerResponse> {
    return { status: 200, json: {} };
  }
}

function projectByName(
  taskManager: StatefulTaskManager,
  name: string,
): FakeProject | undefined {
  return [...taskManager.projects.values()].find(
    (project) => project.name === name,
  );
}

function realFactory(
  codeHost: CodeHostTransport,
  taskManager: TaskManagerTransport,
): MirrorAdapterFactoryPort {
  return {
    create: (application, target) => {
      if (application === 'github') {
        return new CodeHostMirrorAdapter(codeHost, target);
      }
      if (application === 'todoist') {
        return new TaskManagerMirrorAdapter(taskManager, target);
      }
      return null;
    },
  };
}

function codeHostOnlyFactory(
  codeHost: CodeHostTransport,
): MirrorAdapterFactoryPort {
  return {
    create: (application, target) =>
      application === 'github'
        ? new CodeHostMirrorAdapter(codeHost, target)
        : null,
  };
}

function taskManagerOnlyFactory(
  taskManager: TaskManagerTransport,
): MirrorAdapterFactoryPort {
  return {
    create: (application, target) =>
      application === 'todoist'
        ? new TaskManagerMirrorAdapter(taskManager, target)
        : null,
  };
}

interface LifecycleSetup {
  vault: FakeAppVault;
  port: VaultPort;
  registry: SyncStateAdapter;
  action: ProjectLifecycleSyncAction;
  codeHost: StatefulCodeHost;
  taskManager: StatefulTaskManager;
}

async function setupLifecycle(options: {
  vaultArchived: boolean;
  home: string;
  codeHost?: StatefulCodeHost;
  taskManager?: StatefulTaskManager;
}): Promise<LifecycleSetup> {
  const appVault = new FakeAppVault();
  appVault.seed(
    options.vaultArchived ? ARCHIVED_HOME : ACTIVE_HOME,
    options.home,
    MTIME,
  );
  const registry = new SyncStateAdapter(memoryStorage());
  await registry.setEntity({ id: 'e1', notePath: TASK_PATH });

  const vault = vaultAdapter(appFor(appVault), {
    registeredApplications: new Set(['github', 'todoist']),
  });
  const codeHost = options.codeHost ?? new StatefulCodeHost();
  const taskManager = options.taskManager ?? new StatefulTaskManager();
  const action = new ProjectLifecycleSyncAction(
    vault,
    registry,
    realFactory(codeHost, taskManager),
  );
  return {
    vault: appVault,
    port: vault,
    registry,
    action,
    codeHost,
    taskManager,
  };
}

async function seedBaseline(
  registry: SyncStateAdapter,
  side: string,
  archived: boolean,
): Promise<void> {
  await registry.writeBaseline(
    PROJECT,
    'archived',
    side,
    new Baseline(archived ? 'true' : 'false', false),
  );
}

async function seedBaselines(
  registry: SyncStateAdapter,
  sides: readonly string[],
  archived: boolean,
): Promise<void> {
  for (const side of sides) {
    await seedBaseline(registry, side, archived);
  }
}

function taskNote(status: string): string {
  return [
    '---',
    'type: task',
    'labels: ["type:task"]',
    `status: ${status}`,
    '---',
    'The bug happens on resize.',
  ].join('\n');
}

describe('ProjectLifecycleSyncAction — archive and restore against the real adapters (NWM-15)', () => {
  it('archives the vault and the other real mirror when a mirror starts the archive', async () => {
    const codeHost = new StatefulCodeHost({ archived: true });
    const taskManager = new StatefulTaskManager({ archived: false });
    const { vault, registry, action, taskManager: tm } = await setupLifecycle({
      vaultArchived: false,
      home: MIXED_HOME,
      codeHost,
      taskManager,
    });
    await seedBaselines(registry, ['origin', 'mirror:a', 'mirror:b'], false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(codeHost.board?.closed).toBe(true);
    expect(tm.projects.get(TODOIST_TARGET)?.is_archived).toBe(true);
  });

  it('archives both real mirrors when the vault starts the archive', async () => {
    const codeHost = new StatefulCodeHost({ archived: false });
    const taskManager = new StatefulTaskManager({ archived: false });
    const { registry, action, codeHost: ch, taskManager: tm } =
      await setupLifecycle({
        vaultArchived: true,
        home: MIXED_HOME,
        codeHost,
        taskManager,
      });
    await seedBaselines(registry, ['origin', 'mirror:a', 'mirror:b'], false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(ch.board?.closed).toBe(true);
    expect(tm.projects.get(TODOIST_TARGET)?.is_archived).toBe(true);
  });

  it('restores the vault and the other real mirror when a mirror un-archives', async () => {
    const codeHost = new StatefulCodeHost({ archived: false });
    const taskManager = new StatefulTaskManager({ archived: true });
    const { vault, registry, action, codeHost: ch, taskManager: tm } =
      await setupLifecycle({
        vaultArchived: true,
        home: MIXED_HOME,
        codeHost,
        taskManager,
      });
    await seedBaselines(registry, ['origin', 'mirror:a', 'mirror:b'], true);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(false);
    expect(vault.has(ACTIVE_HOME)).toBe(true);
    expect(ch.board?.closed).toBe(false);
    expect(tm.projects.get(TODOIST_TARGET)?.is_archived).toBe(false);
  });

  it('lets a real code-host board win the archive rung on its closedAt when the mirror archived (NWM-6, ADP-3)', async () => {
    const codeHost = new StatefulCodeHost({ archived: true });
    const { vault, registry, action, codeHost: ch } = await setupLifecycle({
      vaultArchived: false,
      home: GITHUB_ONLY_HOME,
      codeHost,
    });
    await seedBaseline(registry, 'origin', true);
    await seedBaseline(registry, 'mirror:a', false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(ch.board?.closed).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
  });

  it('does not let a fresh generic last-modified win the archive rung without an archive-specific time (NWM-6, NWM-12)', async () => {
    const codeHost = new StatefulCodeHost({
      archived: false,
      updatedAt: '2026-10-08T12:00:00Z',
    });
    const { vault, registry, action, codeHost: ch } = await setupLifecycle({
      vaultArchived: true,
      home: GITHUB_ONLY_HOME,
      codeHost,
    });
    await seedBaseline(registry, 'origin', false);
    await seedBaseline(registry, 'mirror:a', true);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(ch.board?.closed).toBe(true);
  });

  it('falls to the vault tie-break when two mirrors disagree without a decisive timestamp (NWM-12)', async () => {
    const codeHost = new StatefulCodeHost({ archived: true });
    const taskManager = new StatefulTaskManager({ archived: false });
    const { vault, registry, action, codeHost: ch, taskManager: tm } =
      await setupLifecycle({
        vaultArchived: false,
        home: MIXED_HOME,
        codeHost,
        taskManager,
      });
    await seedBaseline(registry, 'origin', false);
    await seedBaseline(registry, 'mirror:a', false);
    await seedBaseline(registry, 'mirror:b', true);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(false);
    expect(vault.has(ACTIVE_HOME)).toBe(true);
    expect(ch.board?.closed).toBe(false);
    expect(tm.projects.get(TODOIST_TARGET)?.is_archived).toBe(false);
  });

  it('onboards a missing mirror project, excludes it from observation, and fans it out to the verdict (NWM-15)', async () => {
    const taskManager = new StatefulTaskManager({ id: 'unrelated' });
    const { vault, registry, action, taskManager: tm } = await setupLifecycle({
      vaultArchived: true,
      home: TODOIST_MISSING_HOME,
      taskManager,
    });
    await seedBaseline(registry, 'origin', true);
    await seedBaseline(registry, 'mirror:b', true);

    const record = await action.invoke(PROJECT);

    expect(tm.projects.size).toBe(2);
    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(record.written).toContain('mirror:b');
    expect(projectByName(tm, PROJECT)?.is_archived).toBe(true);
  });

  it('records a failed mirror write and still archives the rest (NWM-2)', async () => {
    const codeHost = new StatefulCodeHost({ archived: true });
    const taskManager = new StatefulTaskManager({ archived: false });
    const { vault, registry, action, taskManager: tm } = await setupLifecycle({
      vaultArchived: false,
      home: MIXED_HOME,
      codeHost,
      taskManager,
    });
    tm.failArchiveFor.add(TODOIST_TARGET);
    await seedBaselines(registry, ['origin', 'mirror:a', 'mirror:b'], false);

    const record = await action.invoke(PROJECT);

    expect(record.failed).toContain('mirror:b');
    expect(record.written).not.toContain('mirror:b');
    expect(record.frozen).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
    expect(tm.projects.get(TODOIST_TARGET)?.is_archived).toBe(false);
  });

  it('re-drives a stranded mirror on the next pass once its transport recovers (NWM-32)', async () => {
    const codeHost = new StatefulCodeHost({ archived: true });
    const taskManager = new StatefulTaskManager({ archived: false });
    const { registry, action, taskManager: tm } = await setupLifecycle({
      vaultArchived: false,
      home: MIXED_HOME,
      codeHost,
      taskManager,
    });
    tm.failArchiveFor.add(TODOIST_TARGET);
    await seedBaselines(registry, ['origin', 'mirror:a', 'mirror:b'], false);
    await action.invoke(PROJECT);

    tm.failArchiveFor.clear();
    const second = await action.invoke(PROJECT);

    expect(second.written).toContain('mirror:b');
    expect(second.advanced).toContain('mirror:b');
    expect(tm.projects.get(TODOIST_TARGET)?.is_archived).toBe(true);
  });

  it('excludes a vanished mirror project without a tombstone or a vault change (NWM-15)', async () => {
    const codeHost = new StatefulCodeHost({ board: 'absent' });
    const { vault, registry, action, codeHost: ch } = await setupLifecycle({
      vaultArchived: false,
      home: GITHUB_ONLY_HOME,
      codeHost,
    });
    await registry.recordMirrorProject(PROJECT, 'a', 'github', GITHUB_TARGET);
    await seedBaseline(registry, 'origin', false);

    const record = await action.invoke(PROJECT);

    expect(record.frozen).toBe(false);
    expect(record.written).toEqual([]);
    expect(vault.has(ACTIVE_HOME)).toBe(true);
    expect(ch.board).toBeNull();
  });

  it('renames a drifted mirror project and archives it in the same pass (NWM-31, NWM-15)', async () => {
    const codeHost = new StatefulCodeHost({
      boardTitle: 'Old Name',
      archived: true,
    });
    const taskManager = new StatefulTaskManager({ archived: false });
    const { vault, registry, action, codeHost: ch, taskManager: tm } =
      await setupLifecycle({
        vaultArchived: false,
        home: MIXED_HOME,
        codeHost,
        taskManager,
      });
    await seedBaselines(registry, ['origin', 'mirror:a', 'mirror:b'], false);

    await action.invoke(PROJECT);

    expect(ch.board?.title).toBe(PROJECT);
    expect(ch.board?.closed).toBe(true);
    expect(tm.projects.get(TODOIST_TARGET)?.is_archived).toBe(true);
    expect(vault.has(ARCHIVED_HOME)).toBe(true);
  });

  it('writes and advances nothing once the archive has fanned out (NWM-24)', async () => {
    const codeHost = new StatefulCodeHost({ archived: true });
    const taskManager = new StatefulTaskManager({ archived: false });
    const { registry, action } = await setupLifecycle({
      vaultArchived: false,
      home: MIXED_HOME,
      codeHost,
      taskManager,
    });
    await seedBaselines(registry, ['origin', 'mirror:a', 'mirror:b'], false);
    await action.invoke(PROJECT);

    const second = await action.invoke(PROJECT);

    expect(second.written).toEqual([]);
    expect(second.advanced).toEqual([]);
  });

  it('renames a drifted code-host board and a drifted task-manager project (NWM-31)', async () => {
    const codeHost = new StatefulCodeHost({ boardTitle: 'Old Name' });
    const taskManager = new StatefulTaskManager({ name: 'Old Name' });
    const { registry, action, codeHost: ch, taskManager: tm } =
      await setupLifecycle({
        vaultArchived: false,
        home: MIXED_HOME,
        codeHost,
        taskManager,
      });
    await seedBaselines(registry, ['origin', 'mirror:a', 'mirror:b'], false);

    await action.invoke(PROJECT);

    expect(ch.board?.title).toBe(PROJECT);
    expect(tm.projects.get(TODOIST_TARGET)?.name).toBe(PROJECT);
  });

  it('relocates the entity on archive and back on restore (NWM-15)', async () => {
    const codeHost = new StatefulCodeHost({ archived: true });
    const taskManager = new StatefulTaskManager({ archived: false });
    const { registry, action } = await setupLifecycle({
      vaultArchived: false,
      home: MIXED_HOME,
      codeHost,
      taskManager,
    });
    await seedBaselines(registry, ['origin', 'mirror:a', 'mirror:b'], false);

    await action.invoke(PROJECT);
    expect((await registry.getEntity('e1'))?.notePath).toBe(
      'Archief/Acme/taken/fix-the-bug.md',
    );

    codeHost.board!.closed = false;
    codeHost.board!.closedAt = null;
    await seedBaseline(registry, 'mirror:a', true);
    await action.invoke(PROJECT);
    expect((await registry.getEntity('e1'))?.notePath).toBe(TASK_PATH);
  });

  it('never tombstones a record relocated under Archief/ (DEL-4, I13)', async () => {
    const codeHost = new StatefulCodeHost({ archived: true });
    const { vault, port, registry, action } = await setupLifecycle({
      vaultArchived: false,
      home: GITHUB_ONLY_HOME,
      codeHost,
    });
    await seedBaselines(registry, ['origin', 'mirror:a'], false);
    await action.invoke(PROJECT);
    expect(vault.has(ACTIVE_HOME)).toBe(false);

    const handleDeleted = new HandleDeletedNoteAction(
      registry,
      codeHostOnlyFactory(codeHost),
    );
    const sweep = new SweepDeletedNotesAction(port, registry, handleDeleted);
    const connections = [
      new ConnectionDataTransferObject({
        slug: 'a',
        application: 'github',
        target: GITHUB_TARGET,
      }),
    ];

    await sweep.execute({ projectName: PROJECT, connections });

    expect(
      await registry.findTombstoneByNotePath(
        'Archief/Acme/taken/fix-the-bug.md',
      ),
    ).toBeNull();
    expect(await registry.getEntity('e1')).not.toBeNull();
  });
});

interface LocksSetup {
  vault: FakeAppVault;
  registry: SyncStateAdapter;
  action: ReconcileProjectTaskLocksAction;
  codeHost: StatefulCodeHost;
  issue: FakeIssue;
}

async function setupLocks(options: {
  status: string;
  extraIssue?: boolean;
}): Promise<LocksSetup> {
  const appVault = new FakeAppVault();
  appVault.seed(ACTIVE_HOME, GITHUB_ONLY_HOME, MTIME);
  appVault.seed(TASK_PATH, taskNote(options.status), MTIME);
  const registry = new SyncStateAdapter(memoryStorage());
  await registry.setEntity({ id: 'e1', notePath: TASK_PATH });
  const codeHost = new StatefulCodeHost();
  const issue = codeHost.addIssue({
    url: ISSUE_URL,
    nodeId: 'I_42',
    number: 42,
  });
  await registry.setMirrorItem(PROJECT, 'a', ISSUE_URL, { entityId: 'e1' });
  if (options.extraIssue === true) {
    const second = codeHost.addIssue({
      url: 'https://github.com/acme/widgets/issues/43',
      nodeId: 'I_43',
      number: 43,
    });
    await registry.setEntity({
      id: 'e2',
      notePath: 'Projecten/Acme/taken/other.md',
    });
    await registry.setMirrorItem(PROJECT, 'a', second.url, { entityId: 'e2' });
  }
  const vault = vaultAdapter(appFor(appVault), {
    registeredApplications: new Set(['github', 'todoist']),
  });
  const action = new ReconcileProjectTaskLocksAction(
    vault,
    registry,
    codeHostOnlyFactory(codeHost),
    'Done',
  );
  return { vault: appVault, registry, action, codeHost, issue };
}

describe('ReconcileProjectTaskLocksAction — issue locking against the real code host (NWM-29)', () => {
  it('locks a tracked issue that is not in the done lane', async () => {
    const { action, codeHost, issue } = await setupLocks({ status: 'Todo' });

    await action.invoke({ project: PROJECT, frozen: true, wasFrozen: false });

    expect(issue.locked).toBe(true);
    expect(codeHost.calls).toContain('lock');
  });

  it('does not lock a tracked issue in the done lane', async () => {
    const { action, codeHost, issue } = await setupLocks({ status: 'Done' });

    await action.invoke({ project: PROJECT, frozen: true, wasFrozen: false });

    expect(issue.locked).toBe(false);
    expect(codeHost.calls).not.toContain('lock');
  });

  it('unlocks every tracked issue on restore (done lane included)', async () => {
    const { action, codeHost, issue } = await setupLocks({ status: 'Done' });

    await action.invoke({ project: PROJECT, frozen: false, wasFrozen: true });

    expect(issue.locked).toBe(false);
    expect(codeHost.calls).toContain('unlock');
  });

  it('leaves a tool without a locking surface alone', async () => {
    const appVault = new FakeAppVault();
    appVault.seed(ARCHIVED_HOME, TODOIST_ONLY_HOME, MTIME);
    appVault.seed(TASK_PATH, taskNote('Todo'), MTIME);
    const registry = new SyncStateAdapter(memoryStorage());
    await registry.setEntity({ id: 'e1', notePath: TASK_PATH });
    await registry.setMirrorItem(PROJECT, 'b', 'task-1', { entityId: 'e1' });
    const taskManager = new StatefulTaskManager();
    const vault = vaultAdapter(appFor(appVault), {
      registeredApplications: new Set(['todoist']),
    });
    const action = new ReconcileProjectTaskLocksAction(
      vault,
      registry,
      taskManagerOnlyFactory(taskManager),
      'Done',
    );

    await action.invoke({ project: PROJECT, frozen: true, wasFrozen: false });

    expect(taskManager.calls).toEqual([]);
  });

  it('one failing unlock does not stop the rest', async () => {
    const { action, codeHost } = await setupLocks({
      status: 'Todo',
      extraIssue: true,
    });
    const first = [...codeHost.issues.values()].find((i) => i.nodeId === 'I_42');
    const second = [...codeHost.issues.values()].find((i) => i.nodeId === 'I_43');
    if (first !== undefined) first.locked = true;
    if (second !== undefined) second.locked = true;
    codeHost.failLockFor.add('I_42');

    await action.invoke({ project: PROJECT, frozen: false, wasFrozen: true });

    expect(first?.locked).toBe(true);
    expect(second?.locked).toBe(false);
  });
});
