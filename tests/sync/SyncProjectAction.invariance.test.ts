import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../src/sync/SyncProjectAction.js';
import { ApplyTaskToGithubAction } from '../../src/github/ApplyTaskToGithubAction.js';
import { ApplyTaskToTodoistAction } from '../../src/todoist/ApplyTaskToTodoistAction.js';
import { ApplyTaskToVaultAction } from '../../src/tasks/ApplyTaskToVaultAction.js';
import { ApplyTodoistCompletionAction } from '../../src/todoist/ApplyTodoistCompletionAction.js';
import { ApplyTodoistRemoteChangesAction } from '../../src/todoist/ApplyTodoistRemoteChangesAction.js';
import { BoardStatusAction } from '../../src/projects/BoardStatusAction.js';
import { CaptureTodoistCreationsAction } from '../../src/todoist/CaptureTodoistCreationsAction.js';
import { CompleteTaskCascadeAction } from '../../src/tasks/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../src/tasks/CreateTaskNoteAction.js';
import { DetectNoteRenamesAction } from '../../src/sync/DetectNoteRenamesAction.js';
import { CleanupNoteFrontmatterAction } from '../../src/sync/CleanupNoteFrontmatterAction.js';
import { EnsureTodoistSectionsAction } from '../../src/todoist/EnsureTodoistSectionsAction.js';
import { HandleDeletedNoteAction } from '../../src/sync/HandleDeletedNoteAction.js';
import { MirrorTodoStatusAction } from '../../src/todos/MirrorTodoStatusAction.js';
import { PropagateStatusAction } from '../../src/tasks/PropagateStatusAction.js';
import { PropagateTodoistDeletionsAction } from '../../src/todoist/PropagateTodoistDeletionsAction.js';
import { ProbeProjectsAction } from '../../src/sync/ProbeProjectsAction.js';
import { ReconcileProjectLifecycleAction } from '../../src/projects/ReconcileProjectLifecycleAction.js';
import { RelinkRenamedTodoAction } from '../../src/todoist/RelinkRenamedTodoAction.js';
import { RelocateTaskStatusAction } from '../../src/tasks/RelocateTaskStatusAction.js';
import { SyncChecklistAction } from '../../src/todos/SyncChecklistAction.js';
import { SyncGithubTasksAction } from '../../src/github/SyncGithubTasksAction.js';
import { SyncTodoistTasksAction } from '../../src/todoist/SyncTodoistTasksAction.js';
import { VerdictResolver } from '../../src/shared/VerdictResolver.js';
import { hash } from '../../src/shared/hash.js';
import type { BoardItemData } from '../../src/shared/BoardItemData.js';
import type { BoardStatusData } from '../../src/shared/BoardStatusData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectDetailData } from '../../src/shared/ProjectDetailData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { ProjectStateData } from '../../src/shared/ProjectStateData.js';
import type { TaskData } from '../../src/shared/TaskData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { CreateTodoistTaskData } from '../../src/todoist/CreateTodoistTaskData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import type { TaskManagerPort } from '../../src/shared/TaskManagerPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import { entityRecord, taskData, todoistTask } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

const DONE_LANE = 'Shipped';

// A vault fake that records every mutator, so a second pass's writes are
// observable. Notes are path-keyed; the project notes are the discovery surface.
class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Map<string, string>();
  projectNotes: ProjectNoteData[] = [];
  mutations: string[] = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.mutations.push(`create:${path}`);
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.mutations.push(`write:${path}`);
  }
  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = this.notes.get(oldPath);
    if (content !== undefined) {
      this.notes.delete(oldPath);
      this.notes.set(newPath, content);
    }
    this.mutations.push(`rename:${oldPath}->${newPath}`);
  }
  async moveFolder(from: string, to: string): Promise<void> {
    this.mutations.push(`move:${from}->${to}`);
  }
  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }
  async trashNote(path: string): Promise<void> {
    this.notes.delete(path);
    this.mutations.push(`trash:${path}`);
  }
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return this.projectNotes;
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeProjectManagement implements ProjectManagementPort {
  identity: ProjectIdentityData | null = null;
  detail: ProjectDetailData = { issues: [], cards: [] };
  states = new Map<string, ProjectStateData>();
  mutations: string[] = [];
  // The board's option-id → lane-name map, so a status write-through lands the
  // card in the lane the real API would place it in.
  optionNames: Record<string, string> = {};
  private nextCardId = 1;

  async fetchProjectIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
  async fetchProjectDetail(): Promise<ProjectDetailData> {
    return this.detail;
  }
  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return this.detail.issues;
  }
  async fetchLatestIssueActivity(): Promise<{
    changed: boolean;
    newestCreatedAt: string | null;
    etag: string | null;
  }> {
    return { changed: false, newestCreatedAt: null, etag: null };
  }
  async fetchProjectStates(): Promise<Map<string, ProjectStateData>> {
    return this.states;
  }
  async setProjectClosed(
    projectNodeId: string,
    closed: boolean,
  ): Promise<void> {
    this.mutations.push(`setProjectClosed:${projectNodeId}:${closed}`);
  }
  async lockIssue(nodeId: string): Promise<void> {
    this.mutations.push(`lockIssue:${nodeId}`);
  }
  async fetchUnpromotedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchTask(): Promise<GithubTaskData> {
    throw new Error('not used');
  }
  async updateTask(
    url: string,
    input: { title: string; body: string },
  ): Promise<GithubTaskData> {
    this.mutations.push(`updateTask:${url}`);
    // Model the real write: the fetched detail must reflect the edit, or a
    // later pass would re-fetch the stale body and never settle.
    const found = this.detail.issues.find((issue) => issue.url === url);
    if (found) {
      found.title = input.title;
      found.body = input.body;
    }
    return this.issueByUrl(url, input.title, input.body);
  }
  async setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<GithubTaskData> {
    this.mutations.push(`setTaskState:${url}:${state}`);
    const found = this.detail.issues.find((issue) => issue.url === url);
    if (found) {
      found.state = state;
    }
    return this.issueByUrl(url);
  }
  async fetchBoardItems(): Promise<BoardItemData[]> {
    return this.detail.cards;
  }
  async setBoardStatus(status: BoardStatusData): Promise<void> {
    this.mutations.push(
      `setBoardStatus:${status.issueUrl}:${status.statusOptionId}`,
    );
    const card = this.detail.cards.find(
      (candidate) => candidate.issueUrl === status.issueUrl,
    );
    const name = this.optionNames[status.statusOptionId];
    if (card && name !== undefined) {
      card.statusOptionName = name;
    }
  }
  async addBoardItem(_projectNodeId: string, issueUrl: string): Promise<void> {
    this.mutations.push(`addBoardItem:${issueUrl}`);
    // Model the real add: the card lands on the board with no lane yet; the
    // caller's follow-up setBoardStatus places it.
    this.detail.cards.push({
      itemId: `C${this.nextCardId++}`,
      type: 'ISSUE',
      issueUrl,
      updatedAt: null,
    });
  }
  async deleteCard(projectNodeId: string, issueUrl: string): Promise<void> {
    this.mutations.push(`deleteCard:${projectNodeId}:${issueUrl}`);
    this.detail.cards = this.detail.cards.filter(
      (card) => card.issueUrl !== issueUrl,
    );
  }
  async addLabel(url: string, label: string): Promise<void> {
    this.mutations.push(`addLabel:${url}:${label}`);
  }
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<GithubTaskData> {
    throw new Error('not used');
  }

  private issueByUrl(
    url: string,
    title?: string,
    body?: string,
  ): GithubTaskData {
    const found = this.detail.issues.find((issue) => issue.url === url);
    if (!found) {
      throw new Error(`unknown issue ${url}`);
    }
    return { ...found, title: title ?? found.title, body: body ?? found.body };
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
}

class FakeTaskManager implements TaskManagerPort {
  projects = new Map<string, TodoistProjectData>();
  sections: TodoistSectionData[] = [];
  active: TodoistTaskData[] = [];
  completed: TodoistTaskData[] = [];
  mutations: string[] = [];
  private nextId = 1;

  async fetchProjects(): Promise<TodoistProjectData[]> {
    return [...this.projects.values()];
  }
  async fetchProject(id: string): Promise<TodoistProjectData | null> {
    return this.projects.get(id) ?? null;
  }
  async createProject(name: string): Promise<TodoistProjectData> {
    const project = { id: `P${++this.nextId}`, name, isArchived: false };
    this.projects.set(project.id, project);
    this.mutations.push(`createProject:${name}`);
    return project;
  }
  async updateProject(id: string, name: string): Promise<void> {
    const project = this.projects.get(id);
    if (project) project.name = name;
    this.mutations.push(`updateProject:${id}`);
  }
  async setProjectArchived(id: string, archived: boolean): Promise<void> {
    const project = this.projects.get(id);
    if (project) project.isArchived = archived;
    this.mutations.push(`setProjectArchived:${id}:${archived}`);
  }
  async fetchSections(projectId: string): Promise<TodoistSectionData[]> {
    return this.sections.filter((section) => section.projectId === projectId);
  }
  async createSection(
    projectId: string,
    name: string,
  ): Promise<TodoistSectionData> {
    const section = { id: `S${++this.nextId}`, projectId, name };
    this.sections.push(section);
    this.mutations.push(`createSection:${name}`);
    return section;
  }
  async updateSection(id: string, name: string): Promise<void> {
    const section = this.sections.find((candidate) => candidate.id === id);
    if (section) section.name = name;
    this.mutations.push(`updateSection:${id}`);
  }
  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
    return this.active;
  }
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    return this.completed;
  }
  async createTask(input: CreateTodoistTaskData): Promise<TodoistTaskData> {
    const task: TodoistTaskData = {
      id: `T${++this.nextId}`,
      projectId: input.projectId,
      sectionId: input.sectionId ?? null,
      parentId: input.parentId ?? null,
      content: input.content,
      labels: [...(input.labels ?? [])],
      isCompleted: false,
      addedAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
      completedAt: null,
    };
    this.active.push(task);
    this.mutations.push(`createTask:${task.content}`);
    return task;
  }
  async updateTask(
    id: string,
    input: { content: string; labels: string[] },
  ): Promise<void> {
    const task = this.active.find((candidate) => candidate.id === id);
    if (task) {
      task.content = input.content;
      task.labels = [...input.labels];
    }
    this.mutations.push(`updateTask:${id}`);
  }
  async moveTask(
    id: string,
    to: { sectionId?: string; parentId?: string },
  ): Promise<void> {
    const task = this.active.find((candidate) => candidate.id === id);
    if (task) {
      if (to.sectionId !== undefined) task.sectionId = to.sectionId;
      if (to.parentId !== undefined) task.parentId = to.parentId;
    }
    this.mutations.push(`moveTask:${id}`);
  }
  async setTaskCompleted(id: string, completed: boolean): Promise<void> {
    const task =
      this.active.find((candidate) => candidate.id === id) ??
      this.completed.find((candidate) => candidate.id === id);
    if (task) {
      task.isCompleted = completed;
      task.completedAt = completed ? UPDATED_AT : null;
      // Model the real API: a completed task leaves the active set and is only
      // visible through the completed-since window.
      this.active = this.active.filter((candidate) => candidate.id !== id);
      this.completed = this.completed.filter(
        (candidate) => candidate.id !== id,
      );
      (completed ? this.completed : this.active).push(task);
    }
    this.mutations.push(`setTaskCompleted:${id}:${completed}`);
  }
  // Models the completed-since window advancing past a completion: the API
  // returns only completions newer than the cursor, so an aged completion drops
  // out of the fetched set while the twin stays completed on Todoist.
  expireCompleted(): void {
    this.completed = [];
  }
  async deleteTask(id: string): Promise<void> {
    // Model the real API: deleting a task removes it and cascades to its
    // subtasks, and a deleted task is gone from BOTH the active and the
    // completed-since sets (otherwise a capture pass would re-anchor it).
    const doomed = new Set<string>();
    const visit = (taskId: string): void => {
      if (doomed.has(taskId)) return;
      doomed.add(taskId);
      for (const task of [...this.active, ...this.completed]) {
        if (task.parentId === taskId) visit(task.id);
      }
    };
    visit(id);
    this.active = this.active.filter((task) => !doomed.has(task.id));
    this.completed = this.completed.filter((task) => !doomed.has(task.id));
    this.mutations.push(`deleteTask:${id}`);
  }
  async ensureLabel(name: string): Promise<void> {
    this.mutations.push(`ensureLabel:${name}`);
  }
}

const NOTE_PATH = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const TODO_PATH = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
const ISSUE_URL = 'https://github.com/acme/widgets/issues/42';
const UPDATED_AT = '2026-09-18T11:00:00Z';
const ENTITY_ID = 'uuid-42';

function taskNote(): string {
  return [
    '---',
    `id: ${ENTITY_ID}`,
    'type: task',
    'status: Building',
    'affiliation: ["[[Acme Widgets]]"]',
    '---',
    `- [ ] [[${TODO_PATH}|Fix the bug]]`,
  ].join('\n');
}

function doneTaskNote(): string {
  return taskNote().replace('status: Building', `status: ${DONE_LANE}`);
}

function toDoNote(): string {
  return [
    '---',
    'status: open',
    'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]',
    '---',
    '',
  ].join('\n');
}

function projectNote(
  projectName: string,
  archivedAt: string | null,
): ProjectNoteData {
  return {
    path: `${archivedAt !== null ? 'Archief' : 'Projecten'}/${projectName}/_${projectName}.md`,
    projectName,
    archivedAt,
    pm: 'github',
    url: 'https://github.com/acme/widgets',
  };
}

// The canonical base the harness seeds for the tracked issue: the diff view the
// first pass compares against.
function githubBase(overrides: Partial<TaskData> = {}): TaskData {
  return taskData({
    id: ENTITY_ID,
    notePath: NOTE_PATH,
    title: 'Fix the bug',
    body: hash('- [ ] Fix the bug'),
    status: 'Building',
    updatedAt: UPDATED_AT,
    type: 'task',
    ...overrides,
  });
}

// Seeds (or replaces) the tracked issue's registry record.
function seedRecord(syncState: FakeSyncState, base: TaskData): void {
  syncState.seed(entityRecord({ id: ENTITY_ID, notePath: base.notePath }), {
    github: { handle: ISSUE_URL, base },
  });
}

interface Harness {
  chain: SyncProjectAction;
  vault: FakeVault;
  syncState: FakeSyncState;
  github: FakeProjectManagement;
  todoist: FakeTaskManager;
}

function harness(): Harness {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const github = new FakeProjectManagement();
  const todoist = new FakeTaskManager();

  // The active project: pm-note, a task note with a checklist, and the to-do the
  // checklist links.
  vault.projectNotes = [
    projectNote('Acme Widgets', null),
    projectNote('Old Project', ''),
  ];
  vault.notes.set(
    'Projecten/Acme Widgets/_Acme Widgets.md',
    '---\npm: github\ntodoist: P1\n---\n',
  );
  vault.notes.set(
    'Archief/Old Project/_Old Project.md',
    '---\npm: github\ntodoist: P2\n---\n',
  );
  vault.notes.set(NOTE_PATH, taskNote());
  vault.notes.set(TODO_PATH, toDoNote());

  seedRecord(syncState, githubBase());

  syncState.identities.set('Acme Widgets', {
    repoUrl: 'https://github.com/acme/widgets',
    repoNodeId: 'R',
    projectNodeId: 'PVT',
    statusFieldId: 'F',
    statusOptions: [
      { id: 'O1', name: 'Unshaped' },
      { id: 'O2', name: 'Building' },
      { id: 'O3', name: DONE_LANE },
    ],
  });

  github.detail = {
    issues: [
      {
        url: ISSUE_URL,
        nodeId: 'I',
        title: 'Fix the bug',
        body: '- [ ] Fix the bug',
        state: 'open',
        createdAt: '2026-09-18T09:00:00Z',
        lastEditedAt: UPDATED_AT,
        updatedAt: UPDATED_AT,
        labels: ['type: task'],
        parentUrl: null,
      },
    ],
    cards: [
      {
        itemId: 'C1',
        type: 'ISSUE',
        issueUrl: ISSUE_URL,
        statusOptionName: 'Building',
        updatedAt: null,
      },
    ],
  };
  github.states.set('PVT', {
    projectId: 'PVT',
    updatedAt: UPDATED_AT,
    closed: false,
  });
  github.optionNames = { O1: 'Unshaped', O2: 'Building', O3: DONE_LANE };

  todoist.projects.set('P1', {
    id: 'P1',
    name: 'Acme Widgets',
    isArchived: false,
  });
  todoist.projects.set('P2', {
    id: 'P2',
    name: 'Old Project',
    isArchived: true,
  });
  todoist.sections = [
    { id: 'S1', projectId: 'P1', name: 'Unshaped' },
    { id: 'S2', projectId: 'P1', name: 'Building' },
    { id: 'S3', projectId: 'P1', name: DONE_LANE },
  ];

  const boardStatus = new BoardStatusAction(syncState, github);
  const propagateStatus = new PropagateStatusAction(
    github,
    syncState,
    boardStatus,
    DONE_LANE,
  );
  const createTaskNote = new CreateTaskNoteAction(vault, syncState, '');
  const applyToGithub = new ApplyTaskToGithubAction(github, syncState);
  const completeTaskCascade = new CompleteTaskCascadeAction(vault, DONE_LANE);
  const applyToVault = new ApplyTaskToVaultAction(
    vault,
    syncState,
    createTaskNote,
    '',
    completeTaskCascade,
  );
  const syncGithubTasks = new SyncGithubTasksAction(
    github,
    syncState,
    vault,
    applyToGithub,
    applyToVault,
    new VerdictResolver(DONE_LANE),
    DONE_LANE,
  );
  const applyToTodoist = new ApplyTaskToTodoistAction(todoist, syncState);
  const applyTodoistCompletion = new ApplyTodoistCompletionAction(
    vault,
    syncState,
    applyToVault,
    DONE_LANE,
  );
  const propagateTodoistDeletions = new PropagateTodoistDeletionsAction(
    todoist,
    vault,
    syncState,
  );
  const relinkRenamedTodo = new RelinkRenamedTodoAction(vault, syncState);
  const relocateTaskStatus = new RelocateTaskStatusAction(syncState);
  const applyTodoistRemoteChanges = new ApplyTodoistRemoteChangesAction(
    vault,
    syncState,
    propagateStatus,
    relocateTaskStatus,
    relinkRenamedTodo,
    DONE_LANE,
  );
  const captureTodoistCreations = new CaptureTodoistCreationsAction(
    vault,
    syncState,
    '',
    DONE_LANE,
  );
  const syncTodoistTasks = new SyncTodoistTasksAction(
    todoist,
    github,
    vault,
    syncState,
    new EnsureTodoistSectionsAction(todoist),
    applyToTodoist,
    applyTodoistRemoteChanges,
    captureTodoistCreations,
    applyTodoistCompletion,
    propagateTodoistDeletions,
    DONE_LANE,
  );
  const lifecycle = new ReconcileProjectLifecycleAction(
    github,
    todoist,
    vault,
    syncState,
    DONE_LANE,
  );
  const renames = new DetectNoteRenamesAction(vault, syncState);
  const syncChecklist = new SyncChecklistAction(vault, '');
  const mirrorTodoStatus = new MirrorTodoStatusAction(vault);
  const handleDeletedNote = new HandleDeletedNoteAction(
    syncState,
    github,
    DONE_LANE,
  );
  const cleanupNoteFrontmatter = new CleanupNoteFrontmatterAction(vault);
  const chain = new SyncProjectAction(
    vault,
    syncState,
    new ProbeProjectsAction(github, syncState),
    lifecycle,
    renames,
    syncGithubTasks,
    completeTaskCascade,
    syncChecklist,
    mirrorTodoStatus,
    syncTodoistTasks,
    handleDeletedNote,
    cleanupNoteFrontmatter,
  );

  return { chain, vault, syncState, github, todoist };
}

// A stable fingerprint of the whole sync state — the registry plus every
// project-level namespace — so the two runs can be compared without depending
// on Map iteration order. The completed-since cursor is excluded: it is the
// window watermark and legitimately advances to syncedAt on every pass, so it
// is bookkeeping, not a reconciliation write. Everything else must be identical.
function fingerprint(state: FakeSyncState): string {
  const sorted = <T>(entries: Iterable<[string, T]>) =>
    [...entries].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(
    {
      records: [...state.records.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      identities: sorted(state.identities),
      lastUpdates: sorted(state.lastUpdates),
      baselines: sorted(state.baselines),
      watches: sorted(state.watches),
      todoistProjects: sorted(
        [...state.todoistProjects.entries()].map(
          ([name, project]) => [name, { sections: project.sections }] as const,
        ),
      ),
    },
    null,
    2,
  );
}

// A GitHub-side external change: the probe's project updatedAt advances so the
// chain's board gate re-opens and the GitHub half re-fetches. Bumping the issues
// too keeps the fetched detail consistent with the probe.
const NEXT_AT = '2026-09-18T12:00:00Z';

function touch(h: Harness, updatedAt = NEXT_AT): void {
  h.github.states.get('PVT')!.updatedAt = updatedAt;
  for (const issue of h.github.detail.issues) {
    issue.updatedAt = updatedAt;
  }
}

// The ids the harness's first settle pass mints, in creation order (the fake's
// nextId pre-increments from 1, so the first task is T2).
const TASK_TWIN = 'T2';
const TODO_TWIN = 'T3';

describe('SYNC-8 — the chain settles: a second pass writes nothing', () => {
  it('performs zero writes on a second pass with no external changes', async () => {
    const h = harness();

    await h.chain.execute('Acme Widgets');
    await h.chain.execute('Old Project');
    const afterFirst = fingerprint(h.syncState);
    // The first pass genuinely reconciled: it materialised the Todoist twins
    // (and stamped the vault anchors), so the second-pass assertion is not
    // vacuous.
    expect(h.todoist.mutations.some((m) => m.startsWith('createTask:'))).toBe(
      true,
    );
    expect(h.vault.mutations.some((m) => m.startsWith('write:'))).toBe(true);

    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];
    await h.chain.execute('Acme Widgets');
    await h.chain.execute('Old Project');

    expect(h.vault.mutations).toEqual([]);
    expect(h.github.mutations).toEqual([]);
    expect(h.todoist.mutations).toEqual([]);

    expect(fingerprint(h.syncState)).toBe(afterFirst);
  });

  it('does not advance the cursor when an apply fails, and retries next pass', async () => {
    const h = harness();
    h.github.detail.issues[0]!.body = '- [ ] Old text';
    seedRecord(
      h.syncState,
      githubBase({ body: hash('- [ ] Old text') }),
    );
    let failNext = true;
    const original = h.github.updateTask.bind(h.github);
    h.github.updateTask = async (...args: Parameters<typeof original>) => {
      if (failNext) {
        failNext = false;
        throw new Error('github apply failed');
      }
      return original(...args);
    };

    await h.chain.execute('Acme Widgets');

    expect(h.syncState.lastUpdates.has('Acme Widgets')).toBe(false);

    await h.chain.execute('Acme Widgets');
    expect(h.syncState.lastUpdates.has('Acme Widgets')).toBe(true);
  });
});

// The dt-13 cascade is origin-agnostic by construction: the chain's vault
// consistency step reads the task note's status and completes its to-dos,
// whichever origin wrote that status. These two scenarios pin the vault-edit
// origin (the vault's done status is pushed, then cascades) and the
// already-arrived origin (the Todoist absorber wrote the done status; the
// GitHub side is settled, so only the consistency step fires).
describe('SyncProjectAction status cascade', () => {
  it('completes a done task to-dos when the vault edit drove the status', async () => {
    const h = harness();
    h.vault.notes.set(NOTE_PATH, doneTaskNote());

    await h.chain.execute('Acme Widgets');

    expect(h.github.mutations).toContain(`setTaskState:${ISSUE_URL}:closed`);
    expect(h.vault.notes.get(TODO_PATH)).toContain('status: completed');
  });

  it('completes a done task to-dos when the status already arrived from a remote', async () => {
    const h = harness();
    h.vault.notes.set(NOTE_PATH, doneTaskNote());
    seedRecord(
      h.syncState,
      githubBase({
        status: DONE_LANE,
        completedAt: '',
        body: hash('- [ ] Fix the bug'),
      }),
    );
    h.github.detail.issues[0]!.state = 'closed';
    h.github.detail.cards[0]!.statusOptionName = DONE_LANE;

    await h.chain.execute('Acme Widgets');

    expect(h.github.mutations).toEqual([]);
    expect(h.vault.notes.get(TODO_PATH)).toContain('status: completed');
  });
});

// The resurrection loop: a trashed note must not return. The sweep deletes the
// card, closes the issue and removes the record; the untracked-closed gate then
// keeps the closed issue from re-materialising on every later poll, and the
// Todoist deletion propagation keeps the twin gone.
describe('SyncProjectAction deletion sweep', () => {
  it('does not resurrect a deleted task after the sweep', async () => {
    const h = harness();
    await h.chain.execute('Acme Widgets');
    expect(await h.syncState.findByMirror('github', ISSUE_URL)).not.toBeNull();
    expect(await h.syncState.findByNotePath(NOTE_PATH)).not.toBeNull();

    h.vault.notes.delete(NOTE_PATH);
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];

    await h.chain.execute('Acme Widgets');

    expect(h.github.mutations).toContain(`deleteCard:PVT:${ISSUE_URL}`);
    expect(h.github.mutations).toContain(`setTaskState:${ISSUE_URL}:closed`);
    expect(await h.syncState.findByMirror('github', ISSUE_URL)).toBeNull();
    expect(h.github.detail.cards).toEqual([]);

    expect(h.todoist.mutations).toContain(`deleteTask:${TASK_TWIN}`);
    expect(h.todoist.active).toEqual([]);
    expect(h.todoist.completed).toEqual([]);
    expect(await h.syncState.findByNotePath(NOTE_PATH)).toBeNull();
    expect(await h.syncState.findByNotePath(TODO_PATH)).toBeNull();

    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];
    await h.chain.execute('Acme Widgets');
    await h.chain.execute('Acme Widgets');

    expect(h.vault.notes.has(NOTE_PATH)).toBe(false);
    expect(h.github.detail.cards).toEqual([]);
    expect(
      h.todoist.mutations.filter((m) => m.startsWith('createTask:')),
    ).toEqual([]);
    expect(h.github.mutations).toEqual([]);
    expect(h.todoist.mutations).toEqual([]);
    expect(h.vault.mutations).toEqual([]);
  });
});

// dt-17 churn fix: once a task/to-do has completed and its base carries the
// stamp, no later pass may re-complete, re-archive or re-write it — even after
// the completed-since window has aged past the completion and the twin is
// returned by neither fetch. The mirror policy (dt-22) keeps the completed twin;
// the settle gate stops the recreate-every-tick loop.
describe('SyncProjectAction completion settle', () => {
  it('performs zero completion writes on N passes after a completion settles', async () => {
    const h = harness();
    h.vault.notes.set(NOTE_PATH, doneTaskNote().replace('- [ ]', '- [x]'));
    seedRecord(
      h.syncState,
      githubBase({
        status: DONE_LANE,
        completedAt: '',
        body: hash('- [x] Fix the bug'),
      }),
    );
    h.github.detail.issues[0]!.body = '- [x] Fix the bug';
    h.github.detail.issues[0]!.state = 'closed';
    h.github.detail.cards[0]!.statusOptionName = DONE_LANE;

    await h.chain.execute('Acme Widgets');
    const completionWrites = h.todoist.mutations.filter((m) =>
      m.startsWith('setTaskCompleted:'),
    );
    expect(completionWrites.length).toBeGreaterThan(0);
    expect(completionWrites.every((m) => m.endsWith(':true'))).toBe(true);

    h.todoist.expireCompleted();
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];

    for (let pass = 0; pass < 3; pass++) {
      await h.chain.execute('Acme Widgets');
    }

    expect(
      h.todoist.mutations.filter((m) => m.startsWith('setTaskCompleted:')),
    ).toEqual([]);
    expect(
      h.todoist.mutations.filter((m) => m.startsWith('createTask:')),
    ).toEqual([]);
    expect(h.vault.mutations).toEqual([]);
    expect(h.github.mutations).toEqual([]);
  });
});

// dt-16 three-way completion from the GitHub surface. The board lane is
// authoritative for done-ness (the t3 decision) and GitHub's built-in project
// workflows move the card when an issue is closed/reopened, so a GitHub-side
// close/reopen arrives as the issue state AND the card lane moving together.
// The chain then reconciles the vault note and the Todoist twin to it.
describe('SyncProjectAction three-way completion from GitHub', () => {
  it('completes the note and its twin when the issue is closed', async () => {
    const h = harness();
    await h.chain.execute('Acme Widgets');

    h.github.detail.issues[0]!.state = 'closed';
    h.github.detail.cards[0]!.statusOptionName = DONE_LANE;
    touch(h);

    await h.chain.execute('Acme Widgets');

    expect(h.vault.notes.get(NOTE_PATH)).toContain(`status: ${DONE_LANE}`);

    expect(h.todoist.completed.map((task) => task.id)).toContain(TASK_TWIN);
    expect(h.todoist.completed.map((task) => task.id)).toContain(TODO_TWIN);

    expect(h.github.mutations).toEqual([]);
  });

  it('reopens the note and its task twin, and leaves the to-dos completed', async () => {
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.github.detail.issues[0]!.state = 'closed';
    h.github.detail.cards[0]!.statusOptionName = DONE_LANE;
    touch(h);
    await h.chain.execute('Acme Widgets');
    await h.chain.execute('Acme Widgets');
    expect(h.vault.notes.get(NOTE_PATH)).toContain(`status: ${DONE_LANE}`);
    expect(h.github.detail.issues[0]!.body).toBe('- [x] Fix the bug');

    h.github.detail.issues[0]!.state = 'open';
    h.github.detail.cards[0]!.statusOptionName = 'Unshaped';
    touch(h, '2026-09-18T13:00:00Z');

    await h.chain.execute('Acme Widgets');
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];
    await h.chain.execute('Acme Widgets');

    expect(h.vault.notes.get(NOTE_PATH)).toContain('status: Unshaped');

    expect(h.todoist.active.map((task) => task.id)).toContain(TASK_TWIN);

    expect(h.todoist.completed.map((task) => task.id)).toContain(TODO_TWIN);

    expect(h.vault.mutations).toEqual([]);
    expect(h.github.mutations).toEqual([]);
    expect(h.todoist.mutations).toEqual([]);
  });
});

// The checklist mirror is driven by the GitHub issue body: a checked/unchecked
// item moves the note's line, its to-do note and the to-do's Todoist twin. This
// is the per-line mirror, distinct from the task-level asymmetric reopen rule.
describe('SyncProjectAction checklist mirror from GitHub', () => {
  it('checks the line, completes the to-do and checks the twin when an item is checked', async () => {
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.github.detail.issues[0]!.body = '- [x] Fix the bug';
    touch(h);

    await h.chain.execute('Acme Widgets');

    expect(h.vault.notes.get(NOTE_PATH)).toContain(
      `- [x] [[${TODO_PATH}|Fix the bug]]`,
    );

    expect(h.vault.notes.get(TODO_PATH)).toContain('status: completed');

    expect(h.todoist.completed.map((task) => task.id)).toContain(TODO_TWIN);
  });

  it('reopens the to-do and unchecks the twin when an item is unchecked', async () => {
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.github.detail.issues[0]!.body = '- [x] Fix the bug';
    touch(h);
    await h.chain.execute('Acme Widgets');
    expect(h.vault.notes.get(TODO_PATH)).toContain('status: completed');

    h.github.detail.issues[0]!.body = '- [ ] Fix the bug';
    touch(h, '2026-09-18T13:00:00Z');

    await h.chain.execute('Acme Widgets');

    expect(h.vault.notes.get(NOTE_PATH)).toContain(
      `- [ ] [[${TODO_PATH}|Fix the bug]]`,
    );

    expect(h.vault.notes.get(TODO_PATH)).toContain('status: open');

    expect(h.todoist.active.map((task) => task.id)).toContain(TODO_TWIN);
    expect(h.todoist.completed.map((task) => task.id)).not.toContain(TODO_TWIN);
  });

  it('trashes the to-do and deletes its twin when an item is removed', async () => {
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.github.detail.issues[0]!.body = 'No items left.';
    touch(h);

    await h.chain.execute('Acme Widgets');

    expect(h.vault.notes.get(NOTE_PATH)).toContain('No items left.');

    expect(h.vault.notes.has(TODO_PATH)).toBe(false);

    expect(h.todoist.mutations).toContain(`deleteTask:${TODO_TWIN}`);
    expect(h.todoist.active.map((task) => task.id)).not.toContain(TODO_TWIN);
    expect(await h.syncState.findByNotePath(TODO_PATH)).toBeNull();

    expect(h.todoist.active.map((task) => task.id)).toContain(TASK_TWIN);
    expect(await h.syncState.findByNotePath(NOTE_PATH)).not.toBeNull();
  });
});

// Reopen after the deletion sweep: the GitHub half materialises only OPEN
// untracked issues, so reopening the swept issue makes it materialise again — a
// fresh note, a NEW board card and a recreated Todoist twin — and the system
// then converges (the next pass writes nothing).
describe('SyncProjectAction reopen after delete', () => {
  it('re-materialises the note, adds a new card and recreates the twin when the issue is reopened', async () => {
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.vault.notes.delete(NOTE_PATH);
    await h.chain.execute('Acme Widgets');
    expect(await h.syncState.findByMirror('github', ISSUE_URL)).toBeNull();
    expect(h.github.detail.cards).toEqual([]);
    expect(h.todoist.active).toEqual([]);

    h.github.detail.issues[0]!.state = 'open';
    touch(h, '2026-09-18T13:00:00Z');

    await h.chain.execute('Acme Widgets');

    const freshPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    expect(h.vault.notes.has(freshPath)).toBe(true);

    expect(h.github.mutations).toContain(`addBoardItem:${ISSUE_URL}`);
    expect(h.github.detail.cards).toHaveLength(1);
    expect(h.github.detail.cards[0]!.statusOptionName).toBe('Unshaped');

    expect(h.todoist.active).toHaveLength(2);
    const taskTwin = h.todoist.active.find((task) => task.parentId === null);
    expect(taskTwin).toBeDefined();
    expect(
      h.todoist.active.some((task) => task.parentId === taskTwin!.id),
    ).toBe(true);
    expect(await h.syncState.findByNotePath(freshPath)).not.toBeNull();
    const records = await h.syncState.list();
    expect(
      records.some((record) =>
        record.notePath.startsWith('Projecten/Acme Widgets/todos/'),
      ),
    ).toBe(true);

    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];
    await h.chain.execute('Acme Widgets');
    expect(h.vault.mutations).toEqual([]);
    expect(h.github.mutations).toEqual([]);
    expect(h.todoist.mutations).toEqual([]);
  });
});

// The live churn loop: a completed Todoist twin whose captured note vanished
// was re-captured every tick (289 duplicate twins). The canonical record is the
// anchor; when the note is gone the record is evicted and the twin deleted, so
// no later pass can re-anchor it. This pins the settle across repeated passes.
describe('SyncProjectAction completed-twin churn', () => {
  it('evicts the stale record and deletes the twin, then writes nothing on N passes', async () => {
    const h = harness();
    await h.chain.execute('Acme Widgets');
    const capturedPath = 'Projecten/Acme Widgets/taken/captured-draft.md';
    const capturedTwin = 'T9';
    h.vault.notes.set(
      capturedPath,
      [
        '---',
        'id: uuid-captured',
        'status: Unshaped',
        'affiliation: ["[[Acme Widgets]]"]',
        `todoist: ${capturedTwin}`,
        '---',
        '- [ ] Captured draft',
      ].join('\n'),
    );
    h.syncState.seed(
      entityRecord({ id: 'uuid-captured', notePath: capturedPath }),
      {
        todoist: {
          handle: capturedTwin,
          base: taskData({
            id: 'uuid-captured',
            notePath: capturedPath,
            title: 'Captured draft',
            status: 'Unshaped',
            completedAt: '',
          }),
        },
      },
    );
    h.todoist.completed.push({
      id: capturedTwin,
      projectId: 'P1',
      sectionId: 'S1',
      parentId: null,
      content: 'Captured draft',
      labels: ['task'],
      isCompleted: true,
      addedAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
      completedAt: UPDATED_AT,
    });

    h.vault.notes.delete(capturedPath);
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];

    await h.chain.execute('Acme Widgets');

    expect(await h.syncState.findByNotePath(capturedPath)).toBeNull();
    expect(h.todoist.active.map((task) => task.id)).not.toContain(capturedTwin);
    expect(h.todoist.completed.map((task) => task.id)).not.toContain(
      capturedTwin,
    );

    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];
    for (let pass = 0; pass < 3; pass++) {
      await h.chain.execute('Acme Widgets');
    }
    expect(h.vault.notes.has(capturedPath)).toBe(false);
    expect(
      h.todoist.mutations.filter((m) => m.startsWith('createTask:')),
    ).toEqual([]);
    expect(await h.syncState.findByNotePath(capturedPath)).toBeNull();
    expect(h.vault.mutations).toEqual([]);
    expect(h.github.mutations).toEqual([]);
    expect(h.todoist.mutations).toEqual([]);
  });
});

// The live bug this ticket fixes: a store predating parent tracking is settled
// (notes match bases) and its board is quiet (the project's updatedAt unmoved),
// yet GitHub-side sub-issue relations changed. The board probe cannot see them —
// adding a sub-issue moves nothing on the board — so the one-shot fullScanPending
// marker forces ONE parent-aware fetch. That single pass discovers the relation,
// seeds the child's affiliation, and moves the already-adopted twin under its
// parent's twin (the GitHub half runs before the Todoist half in the chain).
describe('SyncProjectAction forced full scan', () => {
  const PARENT_URL = 'https://github.com/acme/widgets/issues/40';
  const PARENT_PATH = 'Projecten/Acme Widgets/taken/the-parent.md';
  const PARENT_TWIN = 'T4';

  it('discovers a sub-issue and moves its twin under the parent in one pass', async () => {
    const h = harness();
    await h.chain.execute('Acme Widgets');
    expect(
      h.todoist.active.find((task) => task.id === TASK_TWIN)?.parentId,
    ).toBeNull();
    const settledUpdate = h.syncState.lastUpdates.get('Acme Widgets');

    h.github.detail.issues.push({
      url: PARENT_URL,
      nodeId: 'I40',
      title: 'The parent',
      body: '',
      state: 'open',
      createdAt: '2026-09-18T09:30:00Z',
      lastEditedAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
      labels: ['type: task'],
      parentUrl: null,
    });
    h.github.detail.cards.push({
      itemId: 'C2',
      type: 'ISSUE',
      issueUrl: PARENT_URL,
      statusOptionName: 'Building',
      updatedAt: null,
    });
    h.vault.notes.set(
      PARENT_PATH,
      [
        '---',
        'type: task',
        'status: Building',
        'affiliation: ["[[Acme Widgets]]"]',
        '---',
        '',
      ].join('\n'),
    );
    const parentBase = taskData({
      id: 'uuid-parent',
      notePath: PARENT_PATH,
      title: 'The parent',
      body: hash(''),
      status: 'Building',
      updatedAt: UPDATED_AT,
      type: 'task',
    });
    h.syncState.seed(entityRecord({ id: 'uuid-parent', notePath: PARENT_PATH }), {
      github: { handle: PARENT_URL, base: parentBase },
      todoist: { handle: PARENT_TWIN, base: parentBase },
    });
    h.todoist.active.push(
      todoistTask({
        id: PARENT_TWIN,
        content: 'The parent',
        sectionId: 'S2',
        labels: ['task'],
      }),
    );

    h.github.detail.issues.find((issue) => issue.url === ISSUE_URL)!.parentUrl =
      PARENT_URL;
    expect(h.github.states.get('PVT')!.updatedAt).toBe(settledUpdate);

    h.syncState.fullScanPending.add('Acme Widgets');
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];

    await h.chain.execute('Acme Widgets');

    expect(h.vault.notes.get(NOTE_PATH)).toContain('[[the-parent]]');

    expect(h.todoist.mutations).toContain(`moveTask:${TASK_TWIN}`);
    expect(
      h.todoist.active.find((task) => task.id === TASK_TWIN)?.parentId,
    ).toBe(PARENT_TWIN);

    expect(h.syncState.fullScanPending.has('Acme Widgets')).toBe(false);
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];
    await h.chain.execute('Acme Widgets');
    expect(h.vault.mutations).toEqual([]);
    expect(h.github.mutations).toEqual([]);
    expect(h.todoist.mutations).toEqual([]);
  });
});
