import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The scheduler extends Obsidian's Component; mock it so the test runs
// without the host app. load() triggers onload(), which registers the timer.
vi.mock('obsidian', () => {
  class Component {
    load(): void {
      this.onload();
    }
    onload(): void {}
    registerInterval(id: number): number {
      return id;
    }
  }
  return { Component };
});

import { SyncScheduler } from '../../../src/App/Scheduling/SyncScheduler.js';
import { SyncProjectAction } from '../../../src/Domain/Actions/SyncProjectAction.js';
import { ProbeProjectsAction } from '../../../src/Domain/Actions/ProbeProjectsAction.js';
import type { ReconcileArchiveStateAction } from '../../../src/Domain/Actions/ReconcileArchiveStateAction.js';
import type { ReconcileTodoistProjectAction } from '../../../src/Domain/Actions/ReconcileTodoistProjectAction.js';
import type { ProjectTasksToTodoistAction } from '../../../src/Domain/Actions/ProjectTasksToTodoistAction.js';
import type { ProjectToDosToTodoistAction } from '../../../src/Domain/Actions/ProjectToDosToTodoistAction.js';
import type { PropagateTodoistDeletionsAction } from '../../../src/Domain/Actions/PropagateTodoistDeletionsAction.js';
import type { ApplyTodoistCompletionAction } from '../../../src/Domain/Actions/ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from '../../../src/Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from '../../../src/Domain/Actions/CaptureTodoistCreationsAction.js';
import type { WatchArchivedProjectAction } from '../../../src/Domain/Actions/WatchArchivedProjectAction.js';
import { ReconcileTaskAction } from '../../../src/Domain/Actions/ReconcileTaskAction.js';
import { ApplyRemoteChangeAction } from '../../../src/Domain/Actions/ApplyRemoteChangeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { ApplyBoardChangeAction } from '../../../src/Domain/Actions/ApplyBoardChangeAction.js';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import type { HandleDeletedNoteAction } from '../../../src/Domain/Actions/HandleDeletedNoteAction.js';
import type { SyncChecklistAction } from '../../../src/Domain/Actions/SyncChecklistAction.js';
import type { MirrorTodoStatusAction } from '../../../src/Domain/Actions/MirrorTodoStatusAction.js';
import type { RelinkRenamedTodoAction } from '../../../src/Domain/Actions/RelinkRenamedTodoAction.js';
import type { RelocateTaskStatusAction } from '../../../src/Domain/Actions/RelocateTaskStatusAction.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import {
  GitHubAdapter,
  type Transport,
} from '../../../src/Infrastructure/GitHub/GitHubAdapter.js';

// Fakes at the ports so the scheduler's per-project invocation is observable
// through the real composed action, without touching Obsidian or GitHub.
class FakeVault implements VaultPort {
  noteChangedCb: ((path: string) => void) | null = null;
  noteDeletedCb: ((path: string) => void) | null = null;
  noteRenamedCb: ((oldPath: string, newPath: string) => void) | null = null;
  projectNotes: ProjectNoteData[] = [];
  moveCalls: Array<{ from: string; to: string }> = [];

  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async moveFolder(fromPrefix: string, toPrefix: string): Promise<void> {
    this.moveCalls.push({ from: fromPrefix, to: toPrefix });
  }
  async renameNote(): Promise<void> {}
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return this.projectNotes;
  }
  async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }
  async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(cb: (path: string) => void): void {
    this.noteChangedCb = cb;
  }
  onNoteDeleted(cb: (path: string) => void): void {
    this.noteDeletedCb = cb;
  }
  onNoteRenamed(cb: (oldPath: string, newPath: string) => void): void {
    this.noteRenamedCb = cb;
  }
  fireNoteChanged(path: string): void {
    this.noteChangedCb?.(path);
  }
  fireNoteDeleted(path: string): void {
    this.noteDeletedCb?.(path);
  }
  fireNoteRenamed(oldPath: string, newPath: string): void {
    this.noteRenamedCb?.(oldPath, newPath);
  }
}

class FakeSyncState implements SyncStatePort {
  identity: ProjectIdentityData | null = null;
  lastUpdates = new Map<string, string>();
  lastUpdateSets: Array<{ projectName: string; iso: string }> = [];

  async get(): Promise<Status | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
  async list(): Promise<Status[]> {
    return [];
  }
  async getLastProjectUpdate(projectName: string): Promise<string | null> {
    return this.lastUpdates.get(projectName) ?? null;
  }
  async setLastProjectUpdate(projectName: string, iso: string): Promise<void> {
    this.lastUpdateSets.push({ projectName, iso });
    this.lastUpdates.set(projectName, iso);
  }
  async getArchiveBaseline(): Promise<null> {
    return null;
  }
  async getWatchState(): Promise<{
    etag: string | null;
    cursor: string | null;
  }> {
    return { etag: null, cursor: null };
  }

  async setWatchState(): Promise<void> {}

  async getTodoistProjectState(): Promise<null> {
    return null;
  }
  async setTodoistProjectState(): Promise<void> {}
  async getTodoistState(): Promise<null> {
    return null;
  }
  async setTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<[]> {
    return [];
  }
  async removeTodoistState(): Promise<void> {}

  async setArchiveBaseline(): Promise<void> {}
}

class FakeProjectManagement implements ProjectManagementPort {
  repoUrlCalls: string[] = [];

  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchTrackedIssues(repoUrl: string): Promise<GithubTaskData[]> {
    this.repoUrlCalls.push(repoUrl);
    return [];
  }
  async fetchTask(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async setTaskState(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<BoardItemData[]> {
    return [];
  }
  async setBoardStatus(): Promise<void> {
    throw new Error('not used in this test');
  }
  async addBoardItem(): Promise<void> {
    throw new Error('not used in this test');
  }
  async fetchUnpromotedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }
  async addLabel(): Promise<void> {
    throw new Error('not used in this test');
  }
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }

  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

// A fake reconcile action that records its invocations and can be made slow,
// so the scheduler's debounce and per-project serialisation are observable.
class FakeReconcile {
  calls: Array<{ notePath: string; projectName: string; syncedAt: string }> =
    [];
  events: string[] = [];
  active = 0;
  maxActive = 0;
  private resolvers: Array<() => void> = [];

  constructor(events: string[] = []) {
    this.events = events;
  }

  async execute(input: {
    notePath: string;
    projectName: string;
    syncedAt: string;
  }): Promise<void> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.calls.push(input);
    this.events.push('reconcile');
    await new Promise<void>((resolve) => this.resolvers.push(resolve));
    this.active--;
  }

  releaseAll(): void {
    for (const resolve of this.resolvers) {
      resolve();
    }
    this.resolvers = [];
  }
}

// Fakes for the checklist sync and the parent-line mirror, recording their
// invocations (and order, via a shared events array) without the real vault.
class FakeSyncChecklist {
  calls: Array<{ notePath: string; projectName: string; syncedAt: string }> =
    [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: {
    notePath: string;
    projectName: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
    this.events.push('checklist');
  }
}

class FakeMirrorTodo {
  calls: Array<{ todoPath: string; syncedAt: string }> = [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: { todoPath: string; syncedAt: string }): Promise<void> {
    this.calls.push(input);
    this.events.push('mirror');
  }
}

function idleChecklist(): SyncChecklistAction {
  return new FakeSyncChecklist() as unknown as SyncChecklistAction;
}

function idleMirror(): MirrorTodoStatusAction {
  return new FakeMirrorTodo() as unknown as MirrorTodoStatusAction;
}

// Fakes for the rename actions, recording their invocations (and order, via a
// shared events array) without the real vault or sync state.
class FakeRelinkRenamedTodo {
  calls: Array<{ oldPath: string; newPath: string; syncedAt: string }> = [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: {
    oldPath: string;
    newPath: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
    this.events.push('relink');
  }
}

class FakeRelocateTaskStatus {
  calls: Array<{ oldPath: string; newPath: string }> = [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: { oldPath: string; newPath: string }): Promise<void> {
    this.calls.push(input);
    this.events.push('relocate');
  }
}

function idleRelink(): RelinkRenamedTodoAction {
  return new FakeRelinkRenamedTodo() as unknown as RelinkRenamedTodoAction;
}

function idleRelocate(): RelocateTaskStatusAction {
  return new FakeRelocateTaskStatus() as unknown as RelocateTaskStatusAction;
}

const fakeSyncProject = {
  execute: vi.fn(async () => {}),
} as unknown as SyncProjectAction;

// A probe fake for tests that never tick (their advanced timers stay inside the
// poll interval). Tick tests supply their own probe.
const idleProbe = {
  execute: async () => new Map<string, ProjectStateData>(),
} as unknown as ProbeProjectsAction;

const idleSyncState = new FakeSyncState();

// An archive-reconcile fake for tests that never tick; tick tests that exercise
// a transition supply their own recording fake.
const idleReconcileArchive = {
  execute: async () => {},
} as unknown as ReconcileArchiveStateAction;

// A Todoist project-mirror fake for tests that never tick; tick tests that
// exercise the Todoist half supply their own recording fake.
const idleReconcileTodoist = {
  execute: async () => null,
} as unknown as ReconcileTodoistProjectAction;

// A task-projection fake for tests that never tick; tick tests that exercise
// the projection supply their own recording fake.
const idleProjectTasks = {
  execute: async () => {},
} as unknown as ProjectTasksToTodoistAction;

// t5 remote-verdict and creation fakes for tests that never tick; tick tests
// that exercise the absorption half supply their own recording fakes.
const idleApplyRemoteChanges = {
  execute: async () => {},
} as unknown as ApplyTodoistRemoteChangesAction;

const idleCaptureCreations = {
  execute: async () => {},
} as unknown as CaptureTodoistCreationsAction;

// A to-do completion-pull fake and a to-do projection fake for tests that never
// tick; tick tests that exercise the to-do half supply their own recording
// fakes.
const idleApplyCompletion = {
  execute: async () => {},
} as unknown as ApplyTodoistCompletionAction;

const idleProjectToDos = {
  execute: async () => {},
} as unknown as ProjectToDosToTodoistAction;

// A deletion-propagation fake for tests that never tick; tick and delete tests
// that exercise it supply their own recording fake.
const idlePropagateDeletions = {
  execute: async () => {},
} as unknown as PropagateTodoistDeletionsAction;

// A watch fake for tests that never tick; tick tests that exercise the watch
// supply their own recording fake.
function idleWatch(): WatchArchivedProjectAction {
  return {
    execute: async () => {},
  } as unknown as WatchArchivedProjectAction;
}

// A project note in the shape findProjectNotes returns, for seeding the tick's
// location-derived project list.
function projectNote(projectName: string, archived: boolean): ProjectNoteData {
  return {
    path: `${archived ? 'Archief' : 'Projecten'}/${projectName}/_home.md`,
    projectName,
    archived,
    pm: 'github',
    url: 'https://github.com/acme/widgets',
    board: 'https://github.com/orgs/acme/projects/1',
  };
}

// A routing fake transport: answers the fleet probe, the REST issue reads and
// the board query from one canned set, and records every call so a test can
// assert exactly which queries the poll issued.
function routingTransport(options: {
  states?: Record<string, unknown>;
  issues?: unknown[];
  boardItems?: unknown[];
  issuesStatus?: number;
}) {
  const calls: Array<{ method: string; path?: string; body?: string }> = [];
  const transport: Transport = {
    async post(body) {
      calls.push({ method: 'post', body });
      if (body.includes('FleetState')) {
        return { status: 200, json: { data: options.states ?? {} } };
      }
      return {
        status: 200,
        json: {
          data: { node: { items: { nodes: options.boardItems ?? [] } } },
        },
      };
    },
    async get(path) {
      calls.push({ method: 'get', path });
      return {
        status: options.issuesStatus ?? 200,
        json: options.issues ?? [],
      };
    },
    async getConditional(path, _etag) {
      calls.push({ method: 'getConditional', path });
      return {
        status: options.issuesStatus ?? 200,
        json: options.issues ?? [],
      };
    },
    async patch(path, body) {
      calls.push({ method: 'patch', path, body });
      return { status: 200, json: {} };
    },
    async postPath(path, body) {
      calls.push({ method: 'postPath', path, body });
      return { status: 200, json: {} };
    },
  };
  return { transport, calls };
}

function boardFetches(
  calls: Array<{ method: string; body?: string }>,
): Array<{ method: string; body?: string }> {
  return calls.filter(
    (call) => call.method === 'post' && call.body?.includes('BoardItems'),
  );
}

function issueFetches(
  calls: Array<{ method: string; path?: string }>,
): Array<{ method: string; path?: string }> {
  return calls.filter(
    (call) => call.method === 'get' && call.path?.includes('/issues'),
  );
}

// Builds a scheduler around the given tick dependencies, filling the note-event
// seams with idle fakes the tick never touches.
function schedulerWith(overrides: {
  syncProject: SyncProjectAction;
  probe: ProbeProjectsAction;
  syncState: SyncStatePort;
  vault?: FakeVault | undefined;
  reconcileArchive?: ReconcileArchiveStateAction | undefined;
  reconcileTodoist?: ReconcileTodoistProjectAction | undefined;
  applyRemoteChanges?: ApplyTodoistRemoteChangesAction | undefined;
  captureCreations?: CaptureTodoistCreationsAction | undefined;
  projectTasks?: ProjectTasksToTodoistAction | undefined;
  applyCompletion?: ApplyTodoistCompletionAction | undefined;
  projectToDos?: ProjectToDosToTodoistAction | undefined;
  propagateDeletions?: PropagateTodoistDeletionsAction | undefined;
  watch?: WatchArchivedProjectAction | undefined;
}): SyncScheduler {
  return new SyncScheduler(
    overrides.syncProject,
    overrides.probe,
    overrides.reconcileArchive ?? idleReconcileArchive,
    overrides.reconcileTodoist ?? idleReconcileTodoist,
    overrides.applyRemoteChanges ?? idleApplyRemoteChanges,
    overrides.captureCreations ?? idleCaptureCreations,
    overrides.projectTasks ?? idleProjectTasks,
    overrides.applyCompletion ?? idleApplyCompletion,
    overrides.projectToDos ?? idleProjectToDos,
    overrides.propagateDeletions ?? idlePropagateDeletions,
    overrides.watch ?? idleWatch(),
    overrides.syncState,
    60_000,
    overrides.vault ?? new FakeVault(),
    idleChecklist(),
    idleMirror(),
    new FakeReconcile() as unknown as ReconcileTaskAction,
    new FakeHandleDeleted() as unknown as HandleDeletedNoteAction,
    idleRelink(),
    idleRelocate(),
    0,
  );
}

const projectIdentity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [
    { id: 'PVTSSF_1', name: 'Unshaped' },
    { id: 'PVTSSF_5', name: 'Shipped' },
  ],
};

// Builds a full tick stack — real adapter, real probe and the real sync action
// — over a fake transport, so a test observes the exact queries the poll issues.
// A stored project update can be seeded to exercise the gate.
function tickHarness(options: {
  transport: Transport;
  lastUpdate?: string;
  archived?: boolean;
  reconcileArchive?: ReconcileArchiveStateAction;
  reconcileTodoist?: ReconcileTodoistProjectAction;
  applyRemoteChanges?: ApplyTodoistRemoteChangesAction;
  captureCreations?: CaptureTodoistCreationsAction;
  projectTasks?: ProjectTasksToTodoistAction;
  applyCompletion?: ApplyTodoistCompletionAction;
  projectToDos?: ProjectToDosToTodoistAction;
  propagateDeletions?: PropagateTodoistDeletionsAction;
  watch?: WatchArchivedProjectAction;
}): {
  scheduler: SyncScheduler;
  syncState: FakeSyncState;
  vault: FakeVault;
} {
  const vault = new FakeVault();
  vault.projectNotes = [projectNote('Acme Widgets', options.archived ?? false)];
  const syncState = new FakeSyncState();
  syncState.identity = projectIdentity;
  if (options.lastUpdate !== undefined) {
    syncState.lastUpdates.set('Acme Widgets', options.lastUpdate);
  }

  const github = new GitHubAdapter(options.transport);
  const createTaskNote = new CreateTaskNoteAction(
    vault,
    syncState,
    'Templates/Task.md',
  );
  const applyRemoteChange = new ApplyRemoteChangeAction(
    vault,
    syncState,
    createTaskNote,
    new BoardStatusAction(syncState, github),
    'Templates/Task.md',
  );
  const applyBoardChange = new ApplyBoardChangeAction(
    syncState,
    github,
    vault,
    'Done',
  );
  const syncProject = new SyncProjectAction(
    github,
    syncState,
    applyRemoteChange,
    createTaskNote,
    applyBoardChange,
    'Shipped',
  );
  const scheduler = schedulerWith({
    syncProject,
    probe: new ProbeProjectsAction(github, syncState),
    syncState,
    vault,
    reconcileArchive: options.reconcileArchive,
    reconcileTodoist: options.reconcileTodoist,
    applyRemoteChanges: options.applyRemoteChanges,
    captureCreations: options.captureCreations,
    projectTasks: options.projectTasks,
    applyCompletion: options.applyCompletion,
    projectToDos: options.projectToDos,
    propagateDeletions: options.propagateDeletions,
    watch: options.watch,
  });
  return { scheduler, syncState, vault };
}

// A fake delete handler that records its invocations, so the scheduler's
// wiring of the delete path is observable.
class FakeHandleDeleted {
  calls: Array<{ notePath: string; projectName: string }> = [];

  async execute(input: {
    notePath: string;
    projectName: string;
  }): Promise<void> {
    this.calls.push(input);
  }
}

// A fake deletion propagation that records its invocations (and order, via a
// shared events array), so the scheduler's wiring of the Todoist deletion sweep
// — the delete event and the end of the tick — is observable.
class FakePropagateDeletions {
  calls: Array<{ projectName: string }> = [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: { projectName: string }): Promise<void> {
    this.calls.push(input);
    this.events.push('propagateDeletions');
  }
}

// A fake archive reconcile that records its invocations, so the scheduler's
// tick-time baseline merge is observable.
class FakeReconcileArchive {
  calls: Array<{
    projectName: string;
    locationArchived: boolean;
    closed: boolean;
    syncedAt: string;
  }> = [];

  async execute(input: {
    projectName: string;
    locationArchived: boolean;
    closed: boolean;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
  }
}

// A fake watch action that records its invocations, so the scheduler's routing
// of archived projects to the watch is observable.
class FakeWatchArchivedProject {
  calls: Array<{ projectName: string; syncedAt: string }> = [];

  async execute(input: {
    projectName: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
  }
}

// A fake Todoist project-mirror that records its invocations (and can be made
// to throw), so the scheduler's Todoist half and its failure isolation are
// observable. It returns a project id so the task projection runs; a test can
// set `frozen` to model the archived freeze returning null.
class FakeReconcileTodoist {
  calls: Array<{
    projectName: string;
    notePath: string;
    locationArchived: boolean;
    syncedAt: string;
  }> = [];
  fail = false;
  frozen = false;

  async execute(input: {
    projectName: string;
    notePath: string;
    locationArchived: boolean;
    syncedAt: string;
  }): Promise<string | null> {
    this.calls.push(input);
    if (this.fail) {
      throw new Error('todoist failed');
    }
    return this.frozen ? null : 'P1';
  }
}

// A fake task projection that records its invocations, so the scheduler's
// gating of the projection on the project lifecycle is observable.
class FakeProjectTasks {
  calls: Array<{ projectName: string; projectId: string; syncedAt: string }> =
    [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: {
    projectName: string;
    projectId: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
    this.events.push('projectTasks');
  }
}

// A fake to-do completion pull and a fake to-do projection, recording their
// invocations (and order, via a shared events array), so the scheduler's to-do
// chaining and its apply-before-project ordering are observable.
class FakeApplyCompletion {
  calls: Array<{ projectName: string; projectId: string; syncedAt: string }> =
    [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: {
    projectName: string;
    projectId: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
    this.events.push('applyCompletion');
  }
}

class FakeProjectToDos {
  calls: Array<{ projectName: string; projectId: string; syncedAt: string }> =
    [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: {
    projectName: string;
    projectId: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
    this.events.push('projectToDos');
  }
}

// t5 remote-verdict and creation fakes, recording their invocations (and order,
// via a shared events array), so the scheduler's absorb-before-project
// invariant is observable.
class FakeApplyRemoteChanges {
  calls: Array<{ projectName: string; projectId: string; syncedAt: string }> =
    [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: {
    projectName: string;
    projectId: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
    this.events.push('applyRemoteChanges');
  }
}

class FakeCaptureCreations {
  calls: Array<{ projectName: string; projectId: string; syncedAt: string }> =
    [];

  constructor(private readonly events: string[] = []) {}

  async execute(input: {
    projectName: string;
    projectId: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
    this.events.push('captureCreations');
  }
}

describe('SyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Obsidian runs in a browser where window is the global; the scheduler
    // uses window.setInterval/setTimeout, so point window at the faked globals.
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('invokes the sync action once per project on each tick', async () => {
    // Given — a scheduler wired to two projects on a 60s interval
    const vault = new FakeVault();
    vault.projectNotes = [
      projectNote('Acme Widgets', false),
      projectNote('Other', false),
    ];
    const syncState = new FakeSyncState();
    syncState.identity = {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Unshaped' },
        { id: 'PVTSSF_2', name: 'Shaping' },
        { id: 'PVTSSF_3', name: 'Shaped' },
        { id: 'PVTSSF_4', name: 'Building' },
        { id: 'PVTSSF_5', name: 'Shipped' },
      ],
    };
    const projectManagement = new FakeProjectManagement();
    const createTaskNote = new CreateTaskNoteAction(
      vault,
      syncState,
      'Templates/Task.md',
    );
    const applyRemoteChange = new ApplyRemoteChangeAction(
      vault,
      syncState,
      createTaskNote,
      new BoardStatusAction(syncState, projectManagement),
      'Templates/Task.md',
    );
    const applyBoardChange = new ApplyBoardChangeAction(
      syncState,
      projectManagement,
      vault,
      'Done',
    );
    const syncProject = new SyncProjectAction(
      projectManagement,
      syncState,
      applyRemoteChange,
      createTaskNote,
      applyBoardChange,
      'Shipped',
    );
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const probe = {
      execute: async (projectNames: string[]) =>
        new Map(
          projectNames.map((projectName) => [
            projectName,
            {
              projectId: 'PVT_123',
              updatedAt: '2026-09-18T12:00:00Z',
              closed: false,
            },
          ]),
        ),
    } as unknown as ProbeProjectsAction;
    const scheduler = new SyncScheduler(
      syncProject,
      probe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      syncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      2000,
    );
    scheduler.load();

    // When — one interval elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the action ran once per project, each fetching the tracked set
    expect(projectManagement.repoUrlCalls).toHaveLength(2);
  });

  it('derives the project name from a note change and reconciles it', async () => {
    // Given — a scheduler subscribed to vault note changes
    const vault = new FakeVault();
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      0,
    );
    scheduler.load();

    // When — a task note under Projecten changes
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — the reconcile runs for the derived project with the note path
    expect(reconcile.calls).toHaveLength(1);
    expect(reconcile.calls[0]!.projectName).toBe('Acme Widgets');
    expect(reconcile.calls[0]!.notePath).toBe(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );
  });

  it('runs the checklist sync before the reconcile for a task note change', async () => {
    // Given — a scheduler wired to observe the chained order
    const vault = new FakeVault();
    const events: string[] = [];
    const checklist = new FakeSyncChecklist(events);
    const reconcile = new FakeReconcile(events);
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      checklist as unknown as SyncChecklistAction,
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      0,
    );
    scheduler.load();

    // When — a task note under Projecten/<project>/taken changes
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — the checklist sync runs first, then the reconcile, in one chain
    expect(events).toEqual(['checklist', 'reconcile']);
    expect(checklist.calls[0]!.projectName).toBe('Acme Widgets');
    expect(checklist.calls[0]!.notePath).toBe(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );
    reconcile.releaseAll();
  });

  it('routes a to-do note change to the parent-line mirror', async () => {
    // Given — a scheduler wired to observe routing
    const vault = new FakeVault();
    const events: string[] = [];
    const mirror = new FakeMirrorTodo(events);
    const reconcile = new FakeReconcile(events);
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      mirror as unknown as MirrorTodoStatusAction,
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      0,
    );
    scheduler.load();

    // When — a to-do note under Projecten/<project>/todos changes
    vault.fireNoteChanged('Projecten/Acme Widgets/todos/fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — the mirror runs instead of the reconcile
    expect(events).toEqual(['mirror']);
    expect(mirror.calls[0]!.todoPath).toBe(
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    );
    expect(reconcile.calls).toHaveLength(0);
  });

  it('routes a to-do rename to the relink action', async () => {
    // Given — a scheduler wired to observe rename routing
    const vault = new FakeVault();
    const events: string[] = [];
    const relink = new FakeRelinkRenamedTodo(events);
    const relocate = new FakeRelocateTaskStatus(events);
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      new FakeReconcile() as unknown as ReconcileTaskAction,
      new FakeHandleDeleted() as unknown as HandleDeletedNoteAction,
      relink as unknown as RelinkRenamedTodoAction,
      relocate as unknown as RelocateTaskStatusAction,
      0,
    );
    scheduler.load();

    // When — a to-do under Projecten/<project>/todos is renamed
    vault.fireNoteRenamed(
      'Projecten/Acme Widgets/todos/fi.md',
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    );
    await vi.advanceTimersByTimeAsync(0);

    // Then — the relink action runs with both paths, the relocate does not
    expect(events).toEqual(['relink']);
    expect(relink.calls[0]!.oldPath).toBe('Projecten/Acme Widgets/todos/fi.md');
    expect(relink.calls[0]!.newPath).toBe(
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    );
    expect(relocate.calls).toHaveLength(0);
  });

  it('routes a task-note rename to the status relocate action', async () => {
    // Given — a scheduler wired to observe rename routing
    const vault = new FakeVault();
    const events: string[] = [];
    const relink = new FakeRelinkRenamedTodo(events);
    const relocate = new FakeRelocateTaskStatus(events);
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      new FakeReconcile() as unknown as ReconcileTaskAction,
      new FakeHandleDeleted() as unknown as HandleDeletedNoteAction,
      relink as unknown as RelinkRenamedTodoAction,
      relocate as unknown as RelocateTaskStatusAction,
      0,
    );
    scheduler.load();

    // When — a task note under Projecten/<project>/taken is renamed
    vault.fireNoteRenamed(
      'Projecten/Acme Widgets/taken/42-old.md',
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );
    await vi.advanceTimersByTimeAsync(0);

    // Then — the relocate action runs with both paths, the relink does not
    expect(events).toEqual(['relocate']);
    expect(relocate.calls[0]).toEqual({
      oldPath: 'Projecten/Acme Widgets/taken/42-old.md',
      newPath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    });
    expect(relink.calls).toHaveLength(0);
  });

  it('ignores renames of other Projecten notes', async () => {
    // Given — a scheduler wired to observe rename routing
    const vault = new FakeVault();
    const events: string[] = [];
    const relink = new FakeRelinkRenamedTodo(events);
    const relocate = new FakeRelocateTaskStatus(events);
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      new FakeReconcile() as unknown as ReconcileTaskAction,
      new FakeHandleDeleted() as unknown as HandleDeletedNoteAction,
      relink as unknown as RelinkRenamedTodoAction,
      relocate as unknown as RelocateTaskStatusAction,
      0,
    );
    scheduler.load();

    // When — a note under Projecten that is neither a to-do nor a task changes
    vault.fireNoteRenamed(
      'Projecten/Acme Widgets/board.md',
      'Projecten/Acme Widgets/board-2.md',
    );
    await vi.advanceTimersByTimeAsync(0);

    // Then — no rename action is invoked
    expect(events).toEqual([]);
    expect(relink.calls).toHaveLength(0);
    expect(relocate.calls).toHaveLength(0);
  });

  it('fires a rename immediately, bypassing the debounce', async () => {
    // Given — a scheduler with a 2s debounce
    const vault = new FakeVault();
    const events: string[] = [];
    const relink = new FakeRelinkRenamedTodo(events);
    const relocate = new FakeRelocateTaskStatus(events);
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      new FakeReconcile() as unknown as ReconcileTaskAction,
      new FakeHandleDeleted() as unknown as HandleDeletedNoteAction,
      relink as unknown as RelinkRenamedTodoAction,
      relocate as unknown as RelocateTaskStatusAction,
      2000,
    );
    scheduler.load();

    // When — a to-do is renamed
    vault.fireNoteRenamed(
      'Projecten/Acme Widgets/todos/fi.md',
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    );
    await vi.advanceTimersByTimeAsync(0);

    // Then — it has already run, without waiting out the debounce window
    expect(relink.calls).toHaveLength(1);
  });

  it('ignores note changes outside Projecten', async () => {
    // Given — a scheduler subscribed to vault note changes
    const vault = new FakeVault();
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      0,
    );
    scheduler.load();

    // When — a note outside Projecten changes
    vault.fireNoteChanged('Notes/random.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — no reconcile is scheduled
    expect(reconcile.calls).toHaveLength(0);
  });

  it('debounces rapid note changes into one reconcile', async () => {
    // Given — a scheduler with a 2s debounce
    const vault = new FakeVault();
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      2000,
    );
    scheduler.load();

    // When — several changes for the same project arrive within the window
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(2000);

    // Then — they coalesce into a single reconcile
    expect(reconcile.calls).toHaveLength(1);
    expect(reconcile.calls[0]!.projectName).toBe('Acme Widgets');
  });

  it('serialises reconciles per project so they never overlap', async () => {
    // Given — a scheduler with no debounce and a slow reconcile
    const vault = new FakeVault();
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      0,
    );
    scheduler.load();

    // When — a second change for the same project arrives while the first
    // reconcile is still in flight
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(1);
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — only the first reconcile has started, and never two at once
    expect(reconcile.calls).toHaveLength(1);
    expect(reconcile.maxActive).toBe(1);

    // When — the first reconcile completes
    reconcile.releaseAll();
    await vi.advanceTimersByTimeAsync(1);

    // Then — the second reconcile runs only after the first finished
    expect(reconcile.calls).toHaveLength(2);
    expect(reconcile.maxActive).toBe(1);
  });

  it('wires note deletions to the delete handler, debounced per project', async () => {
    // Given — a scheduler subscribed to vault note deletions
    const vault = new FakeVault();
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      2000,
    );
    scheduler.load();

    // When — a task note under Projecten is deleted twice within the window
    vault.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    vault.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(2000);

    // Then — the delete handler runs once with the note path
    expect(handleDeleted.calls).toHaveLength(1);
    expect(handleDeleted.calls[0]!.notePath).toBe(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );
  });

  it('ignores note deletions outside Projecten', async () => {
    // Given — a scheduler subscribed to vault note deletions
    const vault = new FakeVault();
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      idlePropagateDeletions,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      0,
    );
    scheduler.load();

    // When — a note outside Projecten is deleted
    vault.fireNoteDeleted('Notes/random.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — no delete handler is scheduled
    expect(handleDeleted.calls).toHaveLength(0);
  });

  it('propagates Todoist deletions when a note is deleted', async () => {
    // Given — a scheduler wired to observe the Todoist deletion sweep
    const vault = new FakeVault();
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const propagateDeletions = new FakePropagateDeletions();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      propagateDeletions as unknown as PropagateTodoistDeletionsAction,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      0,
    );
    scheduler.load();

    // When — a task note under Projecten is deleted
    vault.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — both the GitHub handler and the Todoist deletion sweep ran
    expect(handleDeleted.calls).toHaveLength(1);
    expect(propagateDeletions.calls).toEqual([{ projectName: 'Acme Widgets' }]);
  });

  it('ignores deletions under Archief, so a frozen project is never swept', async () => {
    // Given — a scheduler wired to observe deletions
    const vault = new FakeVault();
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const propagateDeletions = new FakePropagateDeletions();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      idleProbe,
      idleReconcileArchive,
      idleReconcileTodoist,
      idleApplyRemoteChanges,
      idleCaptureCreations,
      idleProjectTasks,
      idleApplyCompletion,
      idleProjectToDos,
      propagateDeletions as unknown as PropagateTodoistDeletionsAction,
      idleWatch(),
      idleSyncState,
      60_000,
      vault,
      idleChecklist(),
      idleMirror(),
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      idleRelink(),
      idleRelocate(),
      0,
    );
    scheduler.load();

    // When — an archived project's note is deleted
    vault.fireNoteDeleted('Archief/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — neither handler runs: the freeze is a skip, not an error
    expect(handleDeleted.calls).toHaveLength(0);
    expect(propagateDeletions.calls).toHaveLength(0);
  });

  it('gates the board fetch when the project updatedAt is unchanged', async () => {
    // Given — a stored update equal to the probe's updatedAt
    const { transport, calls } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const { scheduler } = tickHarness({
      transport,
      lastUpdate: '2026-09-18T10:00:00Z',
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the REST reconcile runs in full, but the board is never queried
    expect(issueFetches(calls)).toHaveLength(1);
    expect(boardFetches(calls)).toHaveLength(0);
  });

  it('fetches the board when the project updatedAt changed', async () => {
    // Given — a stored update older than the probe's updatedAt
    const { transport, calls } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T11:00:00Z', closed: false },
      },
    });
    const { scheduler } = tickHarness({
      transport,
      lastUpdate: '2026-09-18T10:00:00Z',
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the board is fetched once
    expect(boardFetches(calls)).toHaveLength(1);
  });

  it('fetches the board on the first run when no update is stored', async () => {
    // Given — a project with no stored update
    const { transport, calls } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const { scheduler } = tickHarness({ transport });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — everything is fetched, so the first run misses nothing
    expect(boardFetches(calls)).toHaveLength(1);
  });

  it('stores the project update only after a successful sync', async () => {
    // Given — a changed project
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T11:00:00Z', closed: false },
      },
    });
    const { scheduler, syncState } = tickHarness({ transport });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the probe's updatedAt is persisted
    expect(syncState.lastUpdateSets).toEqual([
      { projectName: 'Acme Widgets', iso: '2026-09-18T11:00:00Z' },
    ]);
  });

  it('leaves the stored update untouched when the sync throws', async () => {
    // Given — a changed project whose issue read fails
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T11:00:00Z', closed: false },
      },
      issuesStatus: 500,
    });
    const { scheduler, syncState } = tickHarness({
      transport,
      lastUpdate: '2026-09-18T10:00:00Z',
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the old update is kept, so the board retries next tick
    expect(syncState.lastUpdates.get('Acme Widgets')).toBe(
      '2026-09-18T10:00:00Z',
    );
    expect(syncState.lastUpdateSets).toEqual([]);
  });

  it('settles: a second tick over an unchanged project fetches no board', async () => {
    // Given — a project that does not change between ticks
    const { transport, calls } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const { scheduler } = tickHarness({ transport });
    scheduler.load();

    // When — two ticks elapse
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the board is fetched only on the first tick, while the REST
    // reconcile runs on both
    expect(boardFetches(calls)).toHaveLength(1);
    expect(issueFetches(calls)).toHaveLength(2);
  });

  it('routes an archived project to the watch and never syncs it', async () => {
    // Given — an archived project whose board is closed (consistent)
    const { transport, calls } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: true },
      },
    });
    const reconcileArchive = new FakeReconcileArchive();
    const watch = new FakeWatchArchivedProject();
    const { scheduler } = tickHarness({
      transport,
      archived: true,
      reconcileArchive:
        reconcileArchive as unknown as ReconcileArchiveStateAction,
      watch: watch as unknown as WatchArchivedProjectAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the settled state is reconciled (a no-op), the repository is
    // watched, and neither issues nor board are fetched
    expect(reconcileArchive.calls).toEqual([
      {
        projectName: 'Acme Widgets',
        locationArchived: true,
        closed: true,
        syncedAt: expect.any(String),
      },
    ]);
    expect(watch.calls).toEqual([
      { projectName: 'Acme Widgets', syncedAt: expect.any(String) },
    ]);
    expect(issueFetches(calls)).toHaveLength(0);
    expect(boardFetches(calls)).toHaveLength(0);
  });

  it('reconciles an active project whose board is closed, deferring its sync', async () => {
    // Given — an active project whose board was closed on GitHub
    const { transport, calls } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: true },
      },
    });
    const reconcileArchive = new FakeReconcileArchive();
    const { scheduler } = tickHarness({
      transport,
      reconcileArchive:
        reconcileArchive as unknown as ReconcileArchiveStateAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the baseline merge ran (the board gesture archives the folder) and
    // the sync is deferred
    expect(reconcileArchive.calls).toEqual([
      {
        projectName: 'Acme Widgets',
        locationArchived: false,
        closed: true,
        syncedAt: expect.any(String),
      },
    ]);
    expect(issueFetches(calls)).toHaveLength(0);
    expect(boardFetches(calls)).toHaveLength(0);
  });

  it('reconciles and syncs a normal active project', async () => {
    // Given — an active project whose board is open (consistent)
    const { transport, calls } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const reconcileArchive = new FakeReconcileArchive();
    const { scheduler } = tickHarness({
      transport,
      reconcileArchive:
        reconcileArchive as unknown as ReconcileArchiveStateAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the settled state is reconciled (a no-op) and the tracked set is
    // reconciled
    expect(reconcileArchive.calls).toEqual([
      {
        projectName: 'Acme Widgets',
        locationArchived: false,
        closed: false,
        syncedAt: expect.any(String),
      },
    ]);
    expect(issueFetches(calls)).toHaveLength(1);
  });

  it('mirrors the project to Todoist on every tick, after the GitHub half', async () => {
    // Given — an active project with a GitHub attach
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const reconcileTodoist = new FakeReconcileTodoist();
    const { scheduler } = tickHarness({
      transport,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the Todoist half ran with the note path and the location signal
    expect(reconcileTodoist.calls).toEqual([
      {
        projectName: 'Acme Widgets',
        notePath: 'Projecten/Acme Widgets/_home.md',
        locationArchived: false,
        syncedAt: expect.any(String),
      },
    ]);
  });

  it('projects the project tasks after the lifecycle, with the project id', async () => {
    // Given — an active project whose lifecycle resolves a project id
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const reconcileTodoist = new FakeReconcileTodoist();
    const projectTasks = new FakeProjectTasks();
    const { scheduler } = tickHarness({
      transport,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
      projectTasks: projectTasks as unknown as ProjectTasksToTodoistAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the projection ran with the resolved project id
    expect(projectTasks.calls).toEqual([
      {
        projectName: 'Acme Widgets',
        projectId: 'P1',
        syncedAt: expect.any(String),
      },
    ]);
  });

  it('skips the task projection when the project is frozen-archived', async () => {
    // Given — an archived project whose lifecycle returns null (frozen)
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: true },
      },
    });
    const reconcileTodoist = new FakeReconcileTodoist();
    reconcileTodoist.frozen = true;
    const projectTasks = new FakeProjectTasks();
    const { scheduler } = tickHarness({
      transport,
      archived: true,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
      projectTasks: projectTasks as unknown as ProjectTasksToTodoistAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the lifecycle ran but the projection was gated off
    expect(reconcileTodoist.calls).toHaveLength(1);
    expect(projectTasks.calls).toEqual([]);
  });

  it('pulls to-do completions before pushing the to-do projection', async () => {
    // Given — an active project with a GitHub attach
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const events: string[] = [];
    const reconcileTodoist = new FakeReconcileTodoist();
    const projectTasks = new FakeProjectTasks(events);
    const applyCompletion = new FakeApplyCompletion(events);
    const projectToDos = new FakeProjectToDos(events);
    const { scheduler } = tickHarness({
      transport,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
      projectTasks: projectTasks as unknown as ProjectTasksToTodoistAction,
      applyCompletion:
        applyCompletion as unknown as ApplyTodoistCompletionAction,
      projectToDos: projectToDos as unknown as ProjectToDosToTodoistAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the task projection runs, then the completion pull, then the to-do
    // projection, so the vault absorbs remote changes before pushing its own
    expect(events).toEqual(['projectTasks', 'applyCompletion', 'projectToDos']);
    expect(applyCompletion.calls[0]).toEqual({
      projectName: 'Acme Widgets',
      projectId: 'P1',
      syncedAt: expect.any(String),
    });
    expect(projectToDos.calls[0]).toEqual({
      projectName: 'Acme Widgets',
      projectId: 'P1',
      syncedAt: expect.any(String),
    });
  });

  it('absorbs Todoist remote changes and creations before projecting', async () => {
    // Given — an active project with a GitHub attach
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const events: string[] = [];
    const reconcileTodoist = new FakeReconcileTodoist();
    const applyRemoteChanges = new FakeApplyRemoteChanges(events);
    const captureCreations = new FakeCaptureCreations(events);
    const projectTasks = new FakeProjectTasks(events);
    const applyCompletion = new FakeApplyCompletion(events);
    const projectToDos = new FakeProjectToDos(events);
    const { scheduler } = tickHarness({
      transport,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
      applyRemoteChanges:
        applyRemoteChanges as unknown as ApplyTodoistRemoteChangesAction,
      captureCreations:
        captureCreations as unknown as CaptureTodoistCreationsAction,
      projectTasks: projectTasks as unknown as ProjectTasksToTodoistAction,
      applyCompletion:
        applyCompletion as unknown as ApplyTodoistCompletionAction,
      projectToDos: projectToDos as unknown as ProjectToDosToTodoistAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the remote verdicts and creations land in the vault before any
    // projection pushes, so a remote change is never clobbered
    expect(events).toEqual([
      'applyRemoteChanges',
      'captureCreations',
      'projectTasks',
      'applyCompletion',
      'projectToDos',
    ]);
    expect(applyRemoteChanges.calls[0]).toEqual({
      projectName: 'Acme Widgets',
      projectId: 'P1',
      syncedAt: expect.any(String),
    });
    expect(captureCreations.calls[0]).toEqual({
      projectName: 'Acme Widgets',
      projectId: 'P1',
      syncedAt: expect.any(String),
    });
  });

  it('skips the to-do completion pull and projection when frozen-archived', async () => {
    // Given — an archived project whose lifecycle returns null (frozen)
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: true },
      },
    });
    const reconcileTodoist = new FakeReconcileTodoist();
    reconcileTodoist.frozen = true;
    const applyCompletion = new FakeApplyCompletion();
    const projectToDos = new FakeProjectToDos();
    const { scheduler } = tickHarness({
      transport,
      archived: true,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
      applyCompletion:
        applyCompletion as unknown as ApplyTodoistCompletionAction,
      projectToDos: projectToDos as unknown as ProjectToDosToTodoistAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the freeze gates the whole to-do half off
    expect(reconcileTodoist.calls).toHaveLength(1);
    expect(applyCompletion.calls).toEqual([]);
    expect(projectToDos.calls).toEqual([]);
  });

  it('propagates deletions last in the Todoist half, after every projection', async () => {
    // Given — an active project with a GitHub attach
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const events: string[] = [];
    const reconcileTodoist = new FakeReconcileTodoist();
    const projectTasks = new FakeProjectTasks(events);
    const applyCompletion = new FakeApplyCompletion(events);
    const projectToDos = new FakeProjectToDos(events);
    const propagateDeletions = new FakePropagateDeletions(events);
    const { scheduler } = tickHarness({
      transport,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
      projectTasks: projectTasks as unknown as ProjectTasksToTodoistAction,
      applyCompletion:
        applyCompletion as unknown as ApplyTodoistCompletionAction,
      projectToDos: projectToDos as unknown as ProjectToDosToTodoistAction,
      propagateDeletions:
        propagateDeletions as unknown as PropagateTodoistDeletionsAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — deletion propagation closes the tick (spec reconcile step 7): a
    // deleted note's twin never lingers into the next tick's capture pass
    expect(events).toEqual([
      'projectTasks',
      'applyCompletion',
      'projectToDos',
      'propagateDeletions',
    ]);
    expect(propagateDeletions.calls).toEqual([{ projectName: 'Acme Widgets' }]);
  });

  it('skips deletion propagation when the project is frozen-archived', async () => {
    // Given — an archived project whose lifecycle returns null (frozen)
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: true },
      },
    });
    const reconcileTodoist = new FakeReconcileTodoist();
    reconcileTodoist.frozen = true;
    const propagateDeletions = new FakePropagateDeletions();
    const { scheduler } = tickHarness({
      transport,
      archived: true,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
      propagateDeletions:
        propagateDeletions as unknown as PropagateTodoistDeletionsAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the freeze gates the deletion sweep off with the rest of the half
    expect(reconcileTodoist.calls).toHaveLength(1);
    expect(propagateDeletions.calls).toEqual([]);
  });

  it('mirrors an archived project to Todoist and still watches it', async () => {
    // Given — an archived project whose board is closed (consistent)
    const { transport } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: true },
      },
    });
    const reconcileTodoist = new FakeReconcileTodoist();
    const watch = new FakeWatchArchivedProject();
    const { scheduler } = tickHarness({
      transport,
      archived: true,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
      watch: watch as unknown as WatchArchivedProjectAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the Todoist half still ran (to archive the project) alongside the
    // GitHub watch
    expect(reconcileTodoist.calls).toEqual([
      {
        projectName: 'Acme Widgets',
        notePath: 'Archief/Acme Widgets/_home.md',
        locationArchived: true,
        syncedAt: expect.any(String),
      },
    ]);
    expect(watch.calls).toHaveLength(1);
  });

  it('mirrors a project without a GitHub attach, skipping the GitHub half', async () => {
    // Given — a project note with no stored identity, so the probe returns no
    // state for it
    const { transport, calls } = routingTransport({});
    const reconcileTodoist = new FakeReconcileTodoist();
    const { scheduler, syncState } = tickHarness({
      transport,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
    });
    // No stored identity: the project has no GitHub attach.
    syncState.identity = null;
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the Todoist half ran and no GitHub request was made
    expect(reconcileTodoist.calls).toHaveLength(1);
    expect(issueFetches(calls)).toHaveLength(0);
    expect(boardFetches(calls)).toHaveLength(0);
  });

  it('isolates a Todoist failure from the GitHub half', async () => {
    // Given — an active project whose Todoist mirror throws
    const { transport, calls } = routingTransport({
      states: {
        p0: { id: 'PVT_123', updatedAt: '2026-09-18T10:00:00Z', closed: false },
      },
    });
    const reconcileTodoist = new FakeReconcileTodoist();
    reconcileTodoist.fail = true;
    const { scheduler } = tickHarness({
      transport,
      reconcileTodoist:
        reconcileTodoist as unknown as ReconcileTodoistProjectAction,
    });
    scheduler.load();

    // When — one tick elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the GitHub half still fetched the tracked set
    expect(reconcileTodoist.calls).toHaveLength(1);
    expect(issueFetches(calls)).toHaveLength(1);
  });
});
