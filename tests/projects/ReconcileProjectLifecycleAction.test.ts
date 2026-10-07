import { describe, expect, it } from 'vitest';
import { ReconcileProjectLifecycleAction } from '../../src/projects/ReconcileProjectLifecycleAction.js';
import type { BoardItemData } from '../../src/shared/BoardItemData.js';
import type { CreateTodoistTaskData } from '../../src/todoist/CreateTodoistTaskData.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import type { TaskManagerPort } from '../../src/shared/TaskManagerPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import type { TaskData } from '../../src/shared/TaskData.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: the vault holds note content and actually moves folders,
// the sync state holds TaskData records, baselines, watch state and the Todoist
// project bookkeeping and relocates records, the task manager holds the Todoist
// project list, and the project management fake records board mutations and
// serves the latest-issue probe. The lifecycle's merge decisions are what's
// under test; the fakes' real mutation is what makes idempotency observable.
class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Map<string, string>();
  writes: Array<{ path: string; content: string }> = [];
  moveCalls: Array<{ from: string; to: string }> = [];
  renameCalls: Array<{ from: string; to: string }> = [];
  failMove = false;

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.notes.set(path, content);
  }
  async createNote(): Promise<void> {}
  async renameNote(oldPath: string, newPath: string): Promise<void> {
    this.renameCalls.push({ from: oldPath, to: newPath });
    const content = this.notes.get(oldPath);
    if (content !== undefined) {
      this.notes.delete(oldPath);
      this.notes.set(newPath, content);
    }
  }
  async moveFolder(fromPrefix: string, toPrefix: string): Promise<void> {
    this.moveCalls.push({ from: fromPrefix, to: toPrefix });
    if (this.failMove) {
      throw new Error('move failed');
    }
    const from = `${fromPrefix}/`;
    const to = `${toPrefix}/`;
    for (const [path, content] of [...this.notes]) {
      if (path.startsWith(from)) {
        this.notes.delete(path);
        this.notes.set(`${to}${path.slice(from.length)}`, content);
      }
    }
  }
  async listNotesInFolder(): Promise<string[]> {
    return [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return [];
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeTaskManager implements TaskManagerPort {
  projects: TodoistProjectData[] = [];
  createCalls: string[] = [];
  updateCalls: Array<{ id: string; name: string }> = [];
  archiveCalls: Array<{ id: string; archived: boolean }> = [];
  nextId = 'P-new';

  async fetchProjects(): Promise<TodoistProjectData[]> {
    // The real list endpoint omits archived projects; the fake mirrors that so
    // the fetch-by-id path is exercised.
    return this.projects.filter((project) => !project.isArchived);
  }
  async fetchProject(id: string): Promise<TodoistProjectData | null> {
    return this.projects.find((candidate) => candidate.id === id) ?? null;
  }
  async createProject(name: string): Promise<TodoistProjectData> {
    this.createCalls.push(name);
    const project = { id: this.nextId, name, isArchived: false };
    this.projects.push(project);
    return project;
  }
  async updateProject(id: string, name: string): Promise<void> {
    this.updateCalls.push({ id, name });
    const project = this.projects.find((candidate) => candidate.id === id);
    if (project) {
      project.name = name;
    }
  }
  async setProjectArchived(id: string, archived: boolean): Promise<void> {
    this.archiveCalls.push({ id, archived });
    const project = this.projects.find((candidate) => candidate.id === id);
    if (project) {
      project.isArchived = archived;
    }
  }
  async fetchSections(): Promise<TodoistSectionData[]> {
    return [];
  }
  async createSection(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateSection(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async createTask(_input: CreateTodoistTaskData): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async moveTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setTaskCompleted(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async ensureLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  closedCalls: Array<{ projectNodeId: string; closed: boolean }> = [];
  lockedNodeIds: string[] = [];
  failLock = false;
  activity: {
    changed: boolean;
    newestCreatedAt: string | null;
    etag: string | null;
  } = { changed: false, newestCreatedAt: null, etag: null };

  async setProjectClosed(
    projectNodeId: string,
    closed: boolean,
  ): Promise<void> {
    this.closedCalls.push({ projectNodeId, closed });
  }
  async lockIssue(nodeId: string): Promise<void> {
    if (this.failLock) {
      throw new Error('lock failed');
    }
    this.lockedNodeIds.push(nodeId);
  }
  async fetchLatestIssueActivity(): Promise<{
    changed: boolean;
    newestCreatedAt: string | null;
    etag: string | null;
  }> {
    return this.activity;
  }
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchProjectDetail(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchUnpromotedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchTask(url: string): Promise<GithubTaskData> {
    const number = Number(url.split('/').pop());
    return {
      url,
      nodeId: `I_kwDOAAAA${number}`,
      title: 'Fix the bug',
      body: '',
      state: 'open',
      createdAt: '2026-09-18T09:00:00Z',
      lastEditedAt: '2026-09-18T11:00:00Z',
      updatedAt: '2026-09-18T11:00:00Z',
      labels: [],
      parentUrl: null,
    };
  }
  async updateTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setTaskState(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<BoardItemData[]> {
    return [];
  }
  async setBoardStatus(): Promise<void> {}
  async addBoardItem(): Promise<void> {}
  async addLabel(): Promise<void> {}
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchRepoBoards(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createBoardWithStatusField(): Promise<never> {
    throw new Error('not used in this test');
  }
  async listRepoLabels(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createRepoLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
  async adoptBoard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const syncedAt = '2026-09-24T12:00:00Z';
const activeNote = 'Projecten/Acme Widgets/_Acme Widgets.md';
const archivedNote = 'Archief/Acme Widgets/_Acme Widgets.md';
const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const archivedTaskPath = 'Archief/Acme Widgets/taken/42-fix-the-bug.md';
const issueUrl = 'https://github.com/acme/widgets/issues/42';

function note(anchor?: string): string {
  const lines = [
    '---',
    'connections:',
    '  github:',
    '    tool: github',
    '    project: https://github.com/acme/widgets',
  ];
  if (anchor !== undefined) {
    lines.push('  todoist:', '    tool: todoist', `    project: ${anchor}`);
  }
  lines.push('---', '# Acme Widgets');
  return lines.join('\n');
}

// A note carrying the connection envelope: the todoist anchor lives in the
// connection's project value, not the legacy `todoist` property.
function connectionNote(anchor: string): string {
  return [
    '---',
    'connections:',
    '  todoist:',
    '    tool: todoist',
    `    project: ${anchor}`,
    '---',
    '# Acme Widgets',
  ].join('\n');
}

function project(
  overrides: Partial<TodoistProjectData> = {},
): TodoistProjectData {
  return { id: 'P1', name: 'Acme Widgets', isArchived: false, ...overrides };
}

// A tracked issue: the registry record carries the github handle and the
// last-synced base whose status is the lane the lock sweep reads.
function seedRecord(
  syncState: FakeSyncState,
  notePath: string,
  overrides: Partial<TaskData> = {},
): void {
  const base = taskData({
    id: 'entity-42',
    notePath,
    title: 'Fix the bug',
    body: 'abc',
    status: 'Building',
    updatedAt: '2026-09-18T11:00:00Z',
    ...overrides,
  });
  syncState.seed(entityRecord({ id: 'entity-42', notePath }), {
    github: { handle: issueUrl, base },
  });
}

function setup(anchor = 'P1') {
  const vault = new FakeVault();
  vault.notes.set(activeNote, note(anchor));
  vault.notes.set(taskPath, '');
  const taskManager = new FakeTaskManager();
  taskManager.projects = [project()];
  const syncState = new FakeSyncState();
  syncState.identities.set('Acme Widgets', {
    repoUrl: 'https://github.com/acme/widgets',
    repoNodeId: 'R_kgDOAAAA',
    projectNodeId: 'PVT_123',
    statusFieldId: 'PVTF_456',
    statusOptions: [],
  });
  seedRecord(syncState, taskPath);
  const port = new FakeProjectManagement();
  const action = new ReconcileProjectLifecycleAction(
    port,
    taskManager,
    vault,
    syncState,
    'Shipped',
  );
  return { action, vault, taskManager, syncState, port };
}

const activeInput = {
  projectName: 'Acme Widgets',
  notePath: activeNote,
  locationArchived: false,
  syncedAt,
  closed: false,
};

const archivedInput = {
  projectName: 'Acme Widgets',
  notePath: archivedNote,
  locationArchived: true,
  syncedAt,
  closed: true,
};

// A settled archived project: the note under Archief/, the Todoist project
// archived and the baseline archived.
function setupArchived() {
  const h = setup();
  h.vault.notes.delete(activeNote);
  h.vault.notes.set(archivedNote, note('P1'));
  h.taskManager.projects = [project({ isArchived: true })];
  h.syncState.records.clear();
  seedRecord(h.syncState, archivedTaskPath);
  h.syncState.baselines.set('Acme Widgets', {
    locationArchived: true,
    closed: true,
    archivedAt: '',
  });
  return h;
}

// A harness whose discovered home note sits at a legacy path — the migration
// tests' subject. The canonical note is removed so only the legacy file is
// discovered.
function setupLegacyHome(homePath: string, anchor = 'P1') {
  const h = setup(anchor);
  h.vault.notes.delete(activeNote);
  h.vault.notes.set(homePath, note(anchor));
  return h;
}

describe('ARC-2 — any side can start the freeze', () => {
  describe('Todoist project resolution', () => {
    it('creates and stamps the project on first sight', async () => {
      const h = setup('P-missing');
      h.taskManager.projects = [];

      const verdict = await h.action.execute(activeInput);

      expect(h.taskManager.createCalls).toEqual(['Acme Widgets']);
      expect(h.vault.writes).toHaveLength(1);
      expect(h.vault.writes[0]!.content).toContain('project: "P-new"');
      expect(h.syncState.todoistSets).toHaveLength(1);
      expect(verdict.remoteProjectId).toBe('P-new');
      expect(verdict.frozen).toBe(false);
    });

    it('resolves the project from the todoist connection anchor', async () => {
      const h = setup();
      h.vault.notes.set(activeNote, connectionNote('P1'));

      const verdict = await h.action.execute(activeInput);

      expect(h.taskManager.createCalls).toEqual([]);
      expect(verdict.remoteProjectId).toBe('P1');
      expect(h.vault.writes).toEqual([]);
    });

    it('resolves by name before creating, so no duplicate is made', async () => {
      const h = setup('P-missing');
      h.taskManager.projects = [project({ id: 'P9' })];

      const verdict = await h.action.execute(activeInput);

      expect(h.taskManager.createCalls).toEqual([]);
      expect(verdict.remoteProjectId).toBe('P9');
    });

    it('renames the project when the note name drifts', async () => {
      const h = setup();
      h.taskManager.projects = [project({ name: 'Old Name' })];

      await h.action.execute(activeInput);

      expect(h.taskManager.updateCalls).toEqual([
        { id: 'P1', name: 'Acme Widgets' },
      ]);
    });

    it('re-stamps the anchor when it points at a project that no longer exists', async () => {
      const h = setup('P-missing');
      h.taskManager.projects = [project({ id: 'P9' })];

      await h.action.execute(activeInput);

      expect(h.vault.writes[0]!.content).toContain('project: "P9"');
    });

    it('re-stamps the connection project, not a legacy property, for an envelope note', async () => {
      const h = setup();
      h.vault.notes.set(activeNote, connectionNote('P-missing'));
      h.taskManager.projects = [project({ id: 'P9' })];

      await h.action.execute(activeInput);

      const content = h.vault.writes[0]!.content;
      expect(content).toContain('project: "P9"');
      expect(content).not.toContain('todoist: P9');
    });

    it('does nothing when the project note is gone', async () => {
      const h = setup();
      h.vault.notes.delete(activeNote);

      const verdict = await h.action.execute(activeInput);

      expect(h.vault.moveCalls).toEqual([]);
      expect(verdict.frozen).toBe(true);
      expect(verdict.remoteProjectId).toBeNull();
    });
  });

  describe('archive merge (folder ⇄ GitHub board ⇄ Todoist)', () => {
    it('adopts the first observation without transitioning', async () => {
      const h = setup();

      await h.action.execute(activeInput);

      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });
      expect(h.vault.moveCalls).toEqual([]);
      expect(h.port.closedCalls).toEqual([]);
    });

    it('applies a vault gesture in both directions: the board follows the folder', async () => {
      const archived = setup();
      archived.vault.notes.set(archivedNote, note('P1'));
      archived.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });
      await archived.action.execute({ ...archivedInput, closed: false });
      expect(archived.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: true },
      ]);
      expect(archived.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: true,
        closed: true,
        archivedAt: syncedAt,
      });

      const active = setup();
      active.taskManager.projects = [project({ isArchived: true })];
      active.syncState.baselines.set('Acme Widgets', {
        locationArchived: true,
        closed: true,
        archivedAt: '',
      });
      await active.action.execute({ ...activeInput, closed: true });
      expect(active.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: false },
      ]);
    });

    it('applies a GitHub gesture in both directions: the folder follows the board', async () => {
      const archived = setup();
      archived.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });
      await archived.action.execute({ ...activeInput, closed: true });
      expect(archived.vault.moveCalls).toEqual([
        { from: 'Projecten/Acme Widgets', to: 'Archief/Acme Widgets' },
      ]);
      expect([...archived.syncState.records.values()][0]!.notePath).toBe(
        archivedTaskPath,
      );

      const unarchived = setup();
      unarchived.vault.notes.set(archivedNote, note('P1'));
      unarchived.syncState.records.clear();
      seedRecord(unarchived.syncState, archivedTaskPath);
      unarchived.syncState.baselines.set('Acme Widgets', {
        locationArchived: true,
        closed: true,
        archivedAt: '',
      });
      await unarchived.action.execute({ ...archivedInput, closed: false });
      expect(unarchived.vault.moveCalls).toEqual([
        { from: 'Archief/Acme Widgets', to: 'Projecten/Acme Widgets' },
      ]);
    });

    it('resolves a conflict in the vault’s favour: the board follows, no folder move', async () => {
      const h = setup();
      h.vault.notes.set(archivedNote, note('P1'));
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });

      await h.action.execute({ ...archivedInput, closed: false });

      expect(h.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: true },
      ]);
      expect(h.vault.moveCalls).toEqual([]);
    });

    it('does nothing when the observation matches the baseline', async () => {
      const h = setup();
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });

      await h.action.execute(activeInput);

      expect(h.vault.moveCalls).toEqual([]);
      expect(h.port.closedCalls).toEqual([]);
    });

    it('leaves the old baseline when the reconciliation throws', async () => {
      const h = setup();
      h.vault.failMove = true;
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });

      await expect(
        h.action.execute({ ...activeInput, closed: true }),
      ).rejects.toThrow('move failed');

      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });
    });

    it('is idempotent: a second pass over the settled state writes nothing', async () => {
      const h = setup();
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });
      await h.action.execute({ ...activeInput, closed: true });

      h.vault.moveCalls = [];
      h.port.closedCalls = [];
      h.syncState.baselineSets = [];
      await h.action.execute({ ...archivedInput, closed: true });

      expect(h.vault.moveCalls).toEqual([]);
      expect(h.port.closedCalls).toEqual([]);
      expect(h.syncState.baselineSets).toEqual([]);
    });

    it('stamps archivedAt once on the freeze transition and preserves it', async () => {
      const h = setup();
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });

      await h.action.execute({ ...activeInput, closed: true });

      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: true,
        closed: true,
        archivedAt: syncedAt,
      });

      h.syncState.baselineSets = [];
      await h.action.execute(archivedInput);
      expect(h.syncState.baselines.get('Acme Widgets')?.archivedAt).toBe(
        syncedAt,
      );
      expect(h.syncState.baselineSets).toEqual([]);
    });

    it('clears archivedAt when a Todoist unarchive flows back', async () => {
      const h = setupArchived();
      h.taskManager.projects = [project({ isArchived: false })];

      await h.action.execute(archivedInput);

      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });
    });

    it('skips a transition for a project with no stored identity', async () => {
      const h = setup();
      h.syncState.identities.clear();
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });

      await h.action.execute({ ...activeInput, closed: true });

      expect(h.vault.moveCalls).toHaveLength(1);
      expect(h.port.closedCalls).toEqual([]);
    });
  });

  describe('two-way Todoist archive backflow', () => {
    it('flows a Todoist archive and unarchive back to the folder and the board', async () => {
      const archived = setup();
      archived.taskManager.projects = [project({ isArchived: true })];
      archived.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });
      await archived.action.execute(activeInput);
      expect(archived.vault.moveCalls).toEqual([
        { from: 'Projecten/Acme Widgets', to: 'Archief/Acme Widgets' },
      ]);
      expect(archived.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: true },
      ]);

      const unarchived = setup();
      unarchived.vault.notes.set(archivedNote, note('P1'));
      unarchived.syncState.records.clear();
      seedRecord(unarchived.syncState, archivedTaskPath);
      unarchived.syncState.baselines.set('Acme Widgets', {
        locationArchived: true,
        closed: true,
        archivedAt: '',
      });
      await unarchived.action.execute(archivedInput);
      expect(unarchived.vault.moveCalls).toEqual([
        { from: 'Archief/Acme Widgets', to: 'Projecten/Acme Widgets' },
      ]);
      expect(unarchived.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: false },
      ]);
    });

    it('freezes an archived project with a null project id but still polls by id', async () => {
      const h = setupArchived();

      const verdict = await h.action.execute(archivedInput);

      expect(verdict.frozen).toBe(true);
      expect(verdict.remoteProjectId).toBeNull();
      expect(h.taskManager.projects[0]!.id).toBe('P1');
    });
  });

  describe('frozen project watch', () => {
    it('does nothing when the repository answers 304', async () => {
      const h = setupArchived();
      h.port.activity = { changed: false, newestCreatedAt: null, etag: null };

      await h.action.execute(archivedInput);

      expect(h.syncState.watchSets).toEqual([]);
      expect(h.vault.moveCalls).toEqual([]);
    });

    it('adopts the newest issue as the cursor on the first watch', async () => {
      const h = setupArchived();
      h.port.activity = {
        changed: true,
        newestCreatedAt: '2026-09-20T10:00:00Z',
        etag: 'etag-1',
      };

      await h.action.execute(archivedInput);

      expect(h.syncState.watchSets).toEqual([
        {
          projectName: 'Acme Widgets',
          state: { etag: 'etag-1', cursor: '2026-09-20T10:00:00Z' },
        },
      ]);
      expect(h.vault.moveCalls).toEqual([]);
    });

    it('re-activates the project when a newer issue appears', async () => {
      const h = setupArchived();
      h.syncState.watches.set('Acme Widgets', {
        etag: 'etag-1',
        cursor: '2026-09-20T10:00:00Z',
      });
      h.port.activity = {
        changed: true,
        newestCreatedAt: '2026-09-25T10:00:00Z',
        etag: 'etag-2',
      };

      const verdict = await h.action.execute(archivedInput);

      expect(h.vault.moveCalls).toEqual([
        { from: 'Archief/Acme Widgets', to: 'Projecten/Acme Widgets' },
      ]);
      expect(h.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: false },
      ]);
      expect(h.taskManager.archiveCalls).toEqual([
        { id: 'P1', archived: false },
      ]);
      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });
      expect(verdict.archivedAt).toBeNull();
      expect(h.syncState.watchSets.at(-1)).toEqual({
        projectName: 'Acme Widgets',
        state: { etag: null, cursor: null },
      });
    });

    it('refreshes only the etag when the newest issue is not newer', async () => {
      const h = setupArchived();
      h.syncState.watches.set('Acme Widgets', {
        etag: 'etag-1',
        cursor: '2026-09-20T10:00:00Z',
      });
      h.port.activity = {
        changed: true,
        newestCreatedAt: '2026-09-20T10:00:00Z',
        etag: 'etag-2',
      };

      await h.action.execute(archivedInput);

      expect(h.syncState.watchSets).toEqual([
        {
          projectName: 'Acme Widgets',
          state: { etag: 'etag-2', cursor: '2026-09-20T10:00:00Z' },
        },
      ]);
      expect(h.vault.moveCalls).toEqual([]);
    });

    it('skips the watch for a project with no stored identity', async () => {
      const h = setupArchived();
      h.syncState.identities.clear();

      await h.action.execute(archivedInput);

      expect(h.syncState.watchSets).toEqual([]);
    });

    it('leaves the watch state untouched when re-activation fails', async () => {
      const h = setupArchived();
      h.syncState.watches.set('Acme Widgets', {
        etag: 'etag-1',
        cursor: '2026-09-20T10:00:00Z',
      });
      h.port.activity = {
        changed: true,
        newestCreatedAt: '2026-09-25T10:00:00Z',
        etag: 'etag-2',
      };
      h.vault.failMove = true;

      await expect(h.action.execute(archivedInput)).rejects.toThrow(
        'move failed',
      );

      expect(h.syncState.watches.get('Acme Widgets')).toEqual({
        etag: 'etag-1',
        cursor: '2026-09-20T10:00:00Z',
      });
    });
  });

  describe('archive lock', () => {
    it('locks unshipped issues when a GitHub gesture archives the project', async () => {
      const h = setup();
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });

      await h.action.execute({ ...activeInput, closed: true });

      expect(h.port.lockedNodeIds).toEqual(['I_kwDOAAAA42']);
    });

    it('skips shipped issues when archiving: the vault decides done', async () => {
      const h = setup();
      h.syncState.records.clear();
      seedRecord(h.syncState, taskPath, { status: 'Shipped' });
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });

      await h.action.execute({ ...activeInput, closed: true });

      expect(h.port.lockedNodeIds).toEqual([]);
    });

    it('does not lock on first-run adoption', async () => {
      const h = setup();
      h.vault.notes.set(archivedNote, note('P1'));

      await h.action.execute(archivedInput);

      expect(h.port.lockedNodeIds).toEqual([]);
    });

    it('leaves the baseline unwritten when a lock fails, so the next tick retries', async () => {
      const h = setup();
      h.port.failLock = true;
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });

      await expect(
        h.action.execute({ ...activeInput, closed: true }),
      ).rejects.toThrow('lock failed');

      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: false,
        closed: false,
        archivedAt: null,
      });
    });
  });

  describe('home note rename migration', () => {
    const canonical = 'Projecten/Acme Widgets/_Acme Widgets.md';

    it('renames both legacy home-note conventions to the underscore form', async () => {
      for (const legacy of [
        'Projecten/Acme Widgets/_home.md',
        'Projecten/Acme Widgets/Acme Widgets.md',
      ]) {
        const h = setupLegacyHome(legacy);

        await h.action.execute({ ...activeInput, notePath: legacy });

        expect(h.vault.renameCalls, legacy).toEqual([
          { from: legacy, to: canonical },
        ]);
        expect(h.vault.notes.has(legacy), legacy).toBe(false);
        expect(h.vault.notes.has(canonical), legacy).toBe(true);
      }
    });

    it('skips the rename when the target already exists, without clobbering', async () => {
      const legacy = 'Projecten/Acme Widgets/_home.md';
      const h = setupLegacyHome(legacy);
      h.vault.notes.set(canonical, note('P1'));

      await h.action.execute({ ...activeInput, notePath: legacy });

      expect(h.vault.renameCalls).toEqual([]);
      expect(h.vault.notes.has(legacy)).toBe(true);
      expect(h.vault.notes.get(canonical)).toBe(note('P1'));
    });

    it('migrates an archived project under Archief/', async () => {
      const legacy = 'Archief/Acme Widgets/_home.md';
      const target = 'Archief/Acme Widgets/_Acme Widgets.md';
      const h = setupLegacyHome(legacy);

      await h.action.execute({ ...archivedInput, notePath: legacy });

      expect(h.vault.renameCalls).toEqual([{ from: legacy, to: target }]);
      expect(h.vault.notes.has(target)).toBe(true);
    });

    it('stamps the connection project on the renamed file', async () => {
      const legacy = 'Projecten/Acme Widgets/_home.md';
      const h = setupLegacyHome(legacy, 'P-missing');
      h.taskManager.projects = [];

      await h.action.execute({ ...activeInput, notePath: legacy });

      expect(h.vault.renameCalls).toEqual([{ from: legacy, to: canonical }]);
      expect(h.vault.notes.get(canonical)).toContain('project: "P-new"');
      expect(h.vault.notes.has(legacy)).toBe(false);
    });

    it('leaves a folder-renamed note whose basename drifted alone', async () => {
      const legacy = 'Projecten/Acme Widgets/Old Name.md';
      const h = setupLegacyHome(legacy);

      await h.action.execute({ ...activeInput, notePath: legacy });

      expect(h.vault.renameCalls).toEqual([]);
      expect(h.vault.notes.has(legacy)).toBe(true);
    });
  });
});
