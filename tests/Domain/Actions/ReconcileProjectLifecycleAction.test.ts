import { describe, expect, it } from 'vitest';
import { ReconcileProjectLifecycleAction } from '../../../src/Domain/Actions/ReconcileProjectLifecycleAction.js';
import type { ArchiveBaselineData } from '../../../src/Domain/DataTransferObjects/ArchiveBaselineData.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { WatchStateData } from '../../../src/Domain/DataTransferObjects/WatchStateData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

// Fakes at the ports: the vault holds note content and actually moves folders,
// the sync state holds TaskData records, baselines, watch state and the Todoist
// project bookkeeping and relocates records, the task manager holds the Todoist
// project list, and the project management fake records board mutations and
// serves the latest-issue probe. The lifecycle's merge decisions are what's
// under test; the fakes' real mutation is what makes idempotency observable.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  writes: Array<{ path: string; content: string }> = [];
  moveCalls: Array<{ from: string; to: string }> = [];
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
  async renameNote(): Promise<void> {}
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

class FakeSyncState implements SyncStatePort {
  identity: ProjectIdentityData | null = {
    repoUrl: 'https://github.com/acme/widgets',
    repoNodeId: 'R_kgDOAAAA',
    projectNodeId: 'PVT_123',
    statusFieldId: 'PVTF_456',
    statusOptions: [],
  };
  records: TaskData[] = [];
  saved: TaskData[] = [];
  baselines = new Map<string, ArchiveBaselineData>();
  baselineSets: Array<{ projectName: string; baseline: ArchiveBaselineData }> =
    [];
  watch: WatchStateData = { etag: null, cursor: null };
  watchSets: WatchStateData[] = [];
  todoistStates = new Map<string, TodoistProjectStateData>();
  todoistSets: Array<{ projectName: string; state: TodoistProjectStateData }> =
    [];

  async get(): Promise<TaskData | null> {
    return null;
  }
  async set(status: TaskData): Promise<void> {
    this.saved.push(status);
    const index = this.records.findIndex((record) => record.url === status.url);
    if (index >= 0) {
      this.records[index] = status;
    } else {
      this.records.push(status);
    }
  }
  async findByNotePath(): Promise<TaskData | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<TaskData[]> {
    return this.records;
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }
  async setLastProjectUpdate(): Promise<void> {}
  async getArchiveBaseline(
    projectName: string,
  ): Promise<ArchiveBaselineData | null> {
    return this.baselines.get(projectName) ?? null;
  }
  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    this.baselineSets.push({ projectName, baseline });
    this.baselines.set(projectName, baseline);
  }
  async getWatchState(): Promise<WatchStateData> {
    return this.watch;
  }
  async setWatchState(
    _projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    this.watch = state;
    this.watchSets.push(state);
  }
  async getTodoistProjectState(
    projectName: string,
  ): Promise<TodoistProjectStateData | null> {
    return this.todoistStates.get(projectName) ?? null;
  }
  async setTodoistProjectState(
    projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    this.todoistSets.push({ projectName, state });
    this.todoistStates.set(projectName, state);
  }
  async getTodoistState(): Promise<null> {
    return null;
  }
  async setTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<[]> {
    return [];
  }
  async removeTodoistState(): Promise<void> {}
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
      remoteId: number,
      nodeId: `I_kwDOAAAA${number}`,
      title: 'Fix the bug',
      body: '',
      state: 'open',
      updatedAt: '2026-09-18T11:00:00Z',
      labels: [],
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
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const syncedAt = '2026-09-24T12:00:00Z';
const activeNote = 'Projecten/Acme Widgets/_home.md';
const archivedNote = 'Archief/Acme Widgets/_home.md';
const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const archivedTaskPath = 'Archief/Acme Widgets/taken/42-fix-the-bug.md';
const issueUrl = 'https://github.com/acme/widgets/issues/42';

function note(anchor?: string): string {
  const lines = ['---', 'pm: github'];
  if (anchor !== undefined) {
    lines.push(`todoist: ${anchor}`);
  }
  lines.push('---', '# Acme Widgets');
  return lines.join('\n');
}

function project(
  overrides: Partial<TodoistProjectData> = {},
): TodoistProjectData {
  return { id: 'P1', name: 'Acme Widgets', isArchived: false, ...overrides };
}

function record(notePath: string, overrides: Partial<TaskData> = {}): TaskData {
  return taskRecord({
    url: issueUrl,
    remoteId: 42,
    notePath,
    body: 'abc',
    updatedAt: '2026-09-18T11:00:00Z',
    status: 'Building',
    title: 'Fix the bug',
    ...overrides,
  });
}

function setup(anchor = 'P1') {
  const vault = new FakeVault();
  vault.notes.set(activeNote, note(anchor));
  vault.notes.set(taskPath, '');
  const taskManager = new FakeTaskManager();
  taskManager.projects = [project()];
  const syncState = new FakeSyncState();
  syncState.records = [record(taskPath)];
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
  h.syncState.records = [record(archivedTaskPath)];
  h.syncState.baselines.set('Acme Widgets', {
    locationArchived: true,
    closed: true,
  });
  return h;
}

describe('ReconcileProjectLifecycleAction', () => {
  describe('Todoist project resolution', () => {
    it('creates and stamps the project on first sight', async () => {
      // Given — a project note with no anchor and no matching Todoist project
      const h = setup('');
      h.vault.notes.set(activeNote, note());
      h.taskManager.projects = [];

      // When — the lifecycle reconciles
      const verdict = await h.action.execute(activeInput);

      // Then — a project is created, the anchor is stamped and bookkeeping set
      expect(h.taskManager.createCalls).toEqual(['Acme Widgets']);
      expect(h.vault.writes).toHaveLength(1);
      expect(h.vault.writes[0]!.content).toContain('todoist: P-new');
      expect(h.syncState.todoistSets).toHaveLength(1);
      expect(verdict.todoistProjectId).toBe('P-new');
      expect(verdict.frozen).toBe(false);
    });

    it('resolves by name before creating, so no duplicate is made', async () => {
      // Given — a note with no anchor and a Todoist project already named
      const h = setup('');
      h.vault.notes.set(activeNote, note());
      h.taskManager.projects = [project({ id: 'P9' })];

      // When — the lifecycle reconciles
      const verdict = await h.action.execute(activeInput);

      // Then — the existing project is adopted, not a second one created
      expect(h.taskManager.createCalls).toEqual([]);
      expect(verdict.todoistProjectId).toBe('P9');
    });

    it('renames the project when the note name drifts', async () => {
      // Given — the Todoist project still carries an old name
      const h = setup();
      h.taskManager.projects = [project({ name: 'Old Name' })];

      // When — the lifecycle reconciles
      await h.action.execute(activeInput);

      // Then — the project follows the folder name
      expect(h.taskManager.updateCalls).toEqual([
        { id: 'P1', name: 'Acme Widgets' },
      ]);
    });

    it('re-stamps the anchor when it points at a project that no longer exists', async () => {
      // Given — an anchor pointing at a missing project and a name match
      const h = setup('P-missing');
      h.taskManager.projects = [project({ id: 'P9' })];

      // When — the lifecycle reconciles
      await h.action.execute(activeInput);

      // Then — the anchor is re-stamped onto the name match
      expect(h.vault.writes[0]!.content).toContain('todoist: P9');
    });

    it('does nothing when the project note is gone', async () => {
      // Given — a note that is not in the vault
      const h = setup();
      h.vault.notes.delete(activeNote);

      // When — the lifecycle reconciles
      const verdict = await h.action.execute(activeInput);

      // Then — the note's absence no-ops with a frozen verdict
      expect(h.vault.moveCalls).toEqual([]);
      expect(verdict.frozen).toBe(true);
      expect(verdict.todoistProjectId).toBeNull();
    });
  });

  describe('archive merge (folder ⇄ GitHub board ⇄ Todoist)', () => {
    it('adopts the first observation without transitioning', async () => {
      // Given — no baseline yet
      const h = setup();

      // When — the lifecycle reconciles
      await h.action.execute(activeInput);

      // Then — the baseline is adopted and nothing moves
      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: false,
        closed: false,
      });
      expect(h.vault.moveCalls).toEqual([]);
      expect(h.port.closedCalls).toEqual([]);
    });

    it('applies a vault gesture: the folder archived, the board follows', async () => {
      // Given — a settled active project the user moved to Archief/
      const h = setup();
      h.vault.notes.set(archivedNote, note('P1'));
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the lifecycle reconciles an archived folder with an open board
      await h.action.execute({ ...archivedInput, closed: false });

      // Then — the board closes and the baseline settles archived
      expect(h.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: true },
      ]);
      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: true,
        closed: true,
      });
    });

    it('applies a vault gesture back: the folder active, the board reopens', async () => {
      // Given — a settled archived project the user moved to Projecten/
      const h = setup();
      h.taskManager.projects = [project({ isArchived: true })];
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: true,
        closed: true,
      });

      // When — the lifecycle reconciles an active folder with a still-closed
      // board
      await h.action.execute({ ...activeInput, closed: true });

      // Then — the board reopens
      expect(h.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: false },
      ]);
    });

    it('applies a GitHub gesture: a closed board archives the folder', async () => {
      // Given — a settled active project whose board just closed
      const h = setup();
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the lifecycle reconciles with closed: true
      await h.action.execute({ ...activeInput, closed: true });

      // Then — the folder moves to Archief/ and the TaskData records follow
      expect(h.vault.moveCalls).toEqual([
        { from: 'Projecten/Acme Widgets', to: 'Archief/Acme Widgets' },
      ]);
      expect(h.syncState.records[0]!.notePath).toBe(archivedTaskPath);
    });

    it('applies a GitHub gesture back: a reopened board unarchives the folder', async () => {
      // Given — a settled archived project whose board just reopened
      const h = setup();
      h.vault.notes.set(archivedNote, note('P1'));
      h.syncState.records = [record(archivedTaskPath)];
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: true,
        closed: true,
      });

      // When — the lifecycle reconciles with closed: false
      await h.action.execute({ ...archivedInput, closed: false });

      // Then — the folder moves back
      expect(h.vault.moveCalls).toEqual([
        { from: 'Archief/Acme Widgets', to: 'Projecten/Acme Widgets' },
      ]);
    });

    it('resolves a conflict in the vault’s favour: the board follows, no folder move', async () => {
      // Given — both the folder and the board moved
      const h = setup();
      h.vault.notes.set(archivedNote, note('P1'));
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the folder is archived while the board still reads open
      await h.action.execute({ ...archivedInput, closed: false });

      // Then — the vault wins: the board is archived to match, no folder move
      expect(h.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: true },
      ]);
      expect(h.vault.moveCalls).toEqual([]);
    });

    it('does nothing when the observation matches the baseline', async () => {
      // Given — a settled active project
      const h = setup();
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the lifecycle reconciles
      await h.action.execute(activeInput);

      // Then — nothing moves and the baseline is unchanged
      expect(h.vault.moveCalls).toEqual([]);
      expect(h.port.closedCalls).toEqual([]);
    });

    it('leaves the old baseline when the reconciliation throws', async () => {
      // Given — a settled active project whose board gesture fails to move
      const h = setup();
      h.vault.failMove = true;
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the lifecycle reconciles a closed board
      await expect(
        h.action.execute({ ...activeInput, closed: true }),
      ).rejects.toThrow('move failed');

      // Then — the old baseline survives for the next tick to retry
      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: false,
        closed: false,
      });
    });

    it('is idempotent: a second pass over the settled state writes nothing', async () => {
      // Given — a project that just archived
      const h = setup();
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });
      await h.action.execute({ ...activeInput, closed: true });

      // When — a second pass over the settled archived state
      h.vault.moveCalls = [];
      h.port.closedCalls = [];
      h.syncState.baselineSets = [];
      await h.action.execute({ ...archivedInput, closed: true });

      // Then — no write happens
      expect(h.vault.moveCalls).toEqual([]);
      expect(h.port.closedCalls).toEqual([]);
      expect(h.syncState.baselineSets).toEqual([]);
    });

    it('skips a transition for a project with no stored identity', async () => {
      // Given — a project with no GitHub identity
      const h = setup();
      h.syncState.identity = null;
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the board reports closed
      await h.action.execute({ ...activeInput, closed: true });

      // Then — the folder still moves (vault-side) but no board write happens
      expect(h.vault.moveCalls).toHaveLength(1);
      expect(h.port.closedCalls).toEqual([]);
    });
  });

  describe('two-way Todoist archive backflow', () => {
    it('flows a Todoist archive back to the folder and the board', async () => {
      // Given — a settled active project archived on the Todoist side
      const h = setup();
      h.taskManager.projects = [project({ isArchived: true })];
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the lifecycle reconciles
      await h.action.execute(activeInput);

      // Then — the folder moves to Archief/ and the board closes (the cascade)
      expect(h.vault.moveCalls).toEqual([
        { from: 'Projecten/Acme Widgets', to: 'Archief/Acme Widgets' },
      ]);
      expect(h.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: true },
      ]);
    });

    it('flows a Todoist unarchive back to the folder', async () => {
      // Given — a settled archived project unarchived on the Todoist side
      const h = setup();
      h.vault.notes.set(archivedNote, note('P1'));
      h.syncState.records = [record(archivedTaskPath)];
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: true,
        closed: true,
      });

      // When — the lifecycle reconciles an archived folder with an active
      // Todoist project
      await h.action.execute(archivedInput);

      // Then — the folder moves back and the board reopens
      expect(h.vault.moveCalls).toEqual([
        { from: 'Archief/Acme Widgets', to: 'Projecten/Acme Widgets' },
      ]);
      expect(h.port.closedCalls).toEqual([
        { projectNodeId: 'PVT_123', closed: false },
      ]);
    });

    it('freezes an archived project with a null project id but still polls by id', async () => {
      // Given — a settled archived project
      const h = setupArchived();

      // When — the lifecycle reconciles
      const verdict = await h.action.execute(archivedInput);

      // Then — the verdict is frozen and the project was fetched by id
      expect(verdict.frozen).toBe(true);
      expect(verdict.todoistProjectId).toBeNull();
      expect(h.taskManager.projects[0]!.id).toBe('P1');
    });
  });

  describe('frozen project watch', () => {
    it('does nothing when the repository answers 304', async () => {
      // Given — an archived project whose repo is quiet
      const h = setupArchived();
      h.port.activity = { changed: false, newestCreatedAt: null, etag: null };

      // When — the lifecycle reconciles
      await h.action.execute(archivedInput);

      // Then — the watch state is untouched and the project stays archived
      expect(h.syncState.watchSets).toEqual([]);
      expect(h.vault.moveCalls).toEqual([]);
    });

    it('adopts the newest issue as the cursor on the first watch', async () => {
      // Given — an archived project watched for the first time
      const h = setupArchived();
      h.port.activity = {
        changed: true,
        newestCreatedAt: '2026-09-20T10:00:00Z',
        etag: 'etag-1',
      };

      // When — the lifecycle reconciles
      await h.action.execute(archivedInput);

      // Then — the cursor is adopted without reactivating
      expect(h.syncState.watchSets).toEqual([
        { etag: 'etag-1', cursor: '2026-09-20T10:00:00Z' },
      ]);
      expect(h.vault.moveCalls).toEqual([]);
    });

    it('re-activates the project when a newer issue appears', async () => {
      // Given — an archived project whose repo gained a newer issue
      const h = setupArchived();
      h.syncState.watch = { etag: 'etag-1', cursor: '2026-09-20T10:00:00Z' };
      h.port.activity = {
        changed: true,
        newestCreatedAt: '2026-09-25T10:00:00Z',
        etag: 'etag-2',
      };

      // When — the lifecycle reconciles
      const verdict = await h.action.execute(archivedInput);

      // Then — folder back, board reopened, Todoist unarchived, baseline active
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
      });
      expect(verdict.locationArchived).toBe(false);
      expect(h.syncState.watchSets.at(-1)).toEqual({
        etag: null,
        cursor: null,
      });
    });

    it('refreshes only the etag when the newest issue is not newer', async () => {
      // Given — an archived project with no newer issue
      const h = setupArchived();
      h.syncState.watch = { etag: 'etag-1', cursor: '2026-09-20T10:00:00Z' };
      h.port.activity = {
        changed: true,
        newestCreatedAt: '2026-09-20T10:00:00Z',
        etag: 'etag-2',
      };

      // When — the lifecycle reconciles
      await h.action.execute(archivedInput);

      // Then — the etag refreshes and the project stays archived
      expect(h.syncState.watchSets).toEqual([
        { etag: 'etag-2', cursor: '2026-09-20T10:00:00Z' },
      ]);
      expect(h.vault.moveCalls).toEqual([]);
    });

    it('skips the watch for a project with no stored identity', async () => {
      // Given — an archived project with no GitHub identity
      const h = setupArchived();
      h.syncState.identity = null;

      // When — the lifecycle reconciles
      await h.action.execute(archivedInput);

      // Then — no watch read happens
      expect(h.syncState.watchSets).toEqual([]);
    });

    it('leaves the watch state untouched when re-activation fails', async () => {
      // Given — an archived project whose folder move fails on reactivation
      const h = setupArchived();
      h.syncState.watch = { etag: 'etag-1', cursor: '2026-09-20T10:00:00Z' };
      h.port.activity = {
        changed: true,
        newestCreatedAt: '2026-09-25T10:00:00Z',
        etag: 'etag-2',
      };
      h.vault.failMove = true;

      // When — the lifecycle reconciles
      await expect(h.action.execute(archivedInput)).rejects.toThrow(
        'move failed',
      );

      // Then — the watch state survives for the next tick to retry
      expect(h.syncState.watch).toEqual({
        etag: 'etag-1',
        cursor: '2026-09-20T10:00:00Z',
      });
    });
  });

  describe('archive lock', () => {
    it('locks unshipped issues when a GitHub gesture archives the project', async () => {
      // Given — a settled active project whose board closed
      const h = setup();
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the lifecycle reconciles
      await h.action.execute({ ...activeInput, closed: true });

      // Then — the tracked issue is locked
      expect(h.port.lockedNodeIds).toEqual(['I_kwDOAAAA42']);
    });

    it('skips shipped issues when archiving: the vault decides done', async () => {
      // Given — a project whose only record is in the done lane
      const h = setup();
      h.syncState.records = [record(taskPath, { status: 'Shipped' })];
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the lifecycle reconciles an archive
      await h.action.execute({ ...activeInput, closed: true });

      // Then — no issue is locked
      expect(h.port.lockedNodeIds).toEqual([]);
    });

    it('does not lock on first-run adoption', async () => {
      // Given — an archived project seen for the first time
      const h = setup();
      h.vault.notes.set(archivedNote, note('P1'));

      // When — the lifecycle reconciles
      await h.action.execute(archivedInput);

      // Then — adoption never locks
      expect(h.port.lockedNodeIds).toEqual([]);
    });

    it('leaves the baseline unwritten when a lock fails, so the next tick retries', async () => {
      // Given — a project archiving whose issue lock fails
      const h = setup();
      h.port.failLock = true;
      h.syncState.baselines.set('Acme Widgets', {
        locationArchived: false,
        closed: false,
      });

      // When — the lifecycle reconciles
      await expect(
        h.action.execute({ ...activeInput, closed: true }),
      ).rejects.toThrow('lock failed');

      // Then — the old baseline survives
      expect(h.syncState.baselines.get('Acme Widgets')).toEqual({
        locationArchived: false,
        closed: false,
      });
    });
  });
});
