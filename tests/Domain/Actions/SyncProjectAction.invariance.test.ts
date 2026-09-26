import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../../src/Domain/Actions/SyncProjectAction.js';
import { ApplyTaskToGithubAction } from '../../../src/Domain/Actions/ApplyTaskToGithubAction.js';
import { ApplyTaskToTodoistAction } from '../../../src/Domain/Actions/ApplyTaskToTodoistAction.js';
import { ApplyTaskToVaultAction } from '../../../src/Domain/Actions/ApplyTaskToVaultAction.js';
import { ApplyTodoistCompletionAction } from '../../../src/Domain/Actions/ApplyTodoistCompletionAction.js';
import { ApplyTodoistRemoteChangesAction } from '../../../src/Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import { CaptureTodoistCreationsAction } from '../../../src/Domain/Actions/CaptureTodoistCreationsAction.js';
import { CompleteTaskCascadeAction } from '../../../src/Domain/Actions/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { DetectNoteRenamesAction } from '../../../src/Domain/Actions/DetectNoteRenamesAction.js';
import { EnsureTodoistSectionsAction } from '../../../src/Domain/Actions/EnsureTodoistSectionsAction.js';
import { HandleDeletedNoteAction } from '../../../src/Domain/Actions/HandleDeletedNoteAction.js';
import { MirrorTodoStatusAction } from '../../../src/Domain/Actions/MirrorTodoStatusAction.js';
import { PropagateStatusAction } from '../../../src/Domain/Actions/PropagateStatusAction.js';
import { PropagateTodoistDeletionsAction } from '../../../src/Domain/Actions/PropagateTodoistDeletionsAction.js';
import { ProbeProjectsAction } from '../../../src/Domain/Actions/ProbeProjectsAction.js';
import { ReconcileProjectLifecycleAction } from '../../../src/Domain/Actions/ReconcileProjectLifecycleAction.js';
import { RelinkRenamedTodoAction } from '../../../src/Domain/Actions/RelinkRenamedTodoAction.js';
import { RelocateTaskStatusAction } from '../../../src/Domain/Actions/RelocateTaskStatusAction.js';
import { SyncChecklistAction } from '../../../src/Domain/Actions/SyncChecklistAction.js';
import { SyncGithubTasksAction } from '../../../src/Domain/Actions/SyncGithubTasksAction.js';
import { SyncTodoistTasksAction } from '../../../src/Domain/Actions/SyncTodoistTasksAction.js';
import { VerdictResolver } from '../../../src/Domain/Reconciliation/VerdictResolver.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { ArchiveBaselineData } from '../../../src/Domain/DataTransferObjects/ArchiveBaselineData.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectDetailData } from '../../../src/Domain/DataTransferObjects/ProjectDetailData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { WatchStateData } from '../../../src/Domain/DataTransferObjects/WatchStateData.js';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import { taskRecord } from '../../helpers/records.js';

const DONE_LANE = 'Shipped';

// A vault fake that records every mutator, so a second pass's writes are
// observable. Notes are path-keyed; the project notes are the discovery surface.
class FakeVault implements VaultPort {
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

class FakeSyncState implements SyncStatePort {
  statuses = new Map<string, TaskData>();
  todoistStates = new Map<string, TaskData>();
  identities = new Map<string, ProjectIdentityData>();
  lastUpdates = new Map<string, string>();
  baselines = new Map<string, ArchiveBaselineData>();
  watches = new Map<string, WatchStateData>();
  todoistProjects = new Map<string, TodoistProjectStateData>();

  async get(url: string): Promise<TaskData | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: TaskData): Promise<void> {
    this.statuses.set(status.url, status);
  }
  async findByNotePath(notePath: string): Promise<TaskData | null> {
    for (const status of this.statuses.values()) {
      if (status.notePath === notePath) return status;
    }
    return null;
  }
  async remove(url: string): Promise<void> {
    this.statuses.delete(url);
  }
  async list(): Promise<TaskData[]> {
    return [...this.statuses.values()];
  }
  async setIdentity(
    projectName: string,
    identity: ProjectIdentityData,
  ): Promise<void> {
    this.identities.set(projectName, identity);
  }
  async getIdentity(projectName: string): Promise<ProjectIdentityData | null> {
    return this.identities.get(projectName) ?? null;
  }
  async getLastProjectUpdate(projectName: string): Promise<string | null> {
    return this.lastUpdates.get(projectName) ?? null;
  }
  async setLastProjectUpdate(projectName: string, iso: string): Promise<void> {
    this.lastUpdates.set(projectName, iso);
  }
  async getArchiveBaseline(
    projectName: string,
  ): Promise<ArchiveBaselineData | null> {
    return this.baselines.get(projectName) ?? null;
  }
  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    this.baselines.set(projectName, baseline);
  }
  async getWatchState(projectName: string): Promise<WatchStateData> {
    return this.watches.get(projectName) ?? { etag: null, cursor: null };
  }
  async setWatchState(
    projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    this.watches.set(projectName, state);
  }
  async getTodoistProjectState(
    projectName: string,
  ): Promise<TodoistProjectStateData | null> {
    return this.todoistProjects.get(projectName) ?? null;
  }
  async setTodoistProjectState(
    projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    this.todoistProjects.set(projectName, state);
  }
  async getTodoistState(notePath: string): Promise<TaskData | null> {
    return this.todoistStates.get(notePath) ?? null;
  }
  async setTodoistState(notePath: string, state: TaskData): Promise<void> {
    if (state.todoistId !== '') {
      for (const [key, value] of this.todoistStates) {
        if (key !== notePath && value.todoistId === state.todoistId) {
          this.todoistStates.delete(key);
        }
      }
    }
    this.todoistStates.set(notePath, state);
  }
  async removeTodoistState(notePath: string): Promise<void> {
    this.todoistStates.delete(notePath);
  }
  async listTodoistStates(): Promise<TaskData[]> {
    return [...this.todoistStates.values()];
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  identity: ProjectIdentityData | null = null;
  detail: ProjectDetailData = { issues: [], cards: [] };
  states = new Map<string, ProjectStateData>();
  mutations: string[] = [];

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
    return this.issueByUrl(url, input.title, input.body);
  }
  async setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<GithubTaskData> {
    this.mutations.push(`setTaskState:${url}:${state}`);
    return this.issueByUrl(url);
  }
  async fetchBoardItems(): Promise<BoardItemData[]> {
    return this.detail.cards;
  }
  async setBoardStatus(
    _projectNodeId: string,
    _statusFieldId: string,
    issueUrl: string,
    statusOptionId: string,
  ): Promise<void> {
    this.mutations.push(`setBoardStatus:${issueUrl}:${statusOptionId}`);
  }
  async addBoardItem(_projectNodeId: string, issueUrl: string): Promise<void> {
    this.mutations.push(`addBoardItem:${issueUrl}`);
  }
  async addLabel(url: string, label: string): Promise<void> {
    this.mutations.push(`addLabel:${url}:${label}`);
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
      url: '',
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
    const task = this.active.find((candidate) => candidate.id === id);
    if (task) task.isCompleted = completed;
    this.mutations.push(`setTaskCompleted:${id}:${completed}`);
  }
  async deleteTask(id: string): Promise<void> {
    this.active = this.active.filter((candidate) => candidate.id !== id);
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

function taskNote(): string {
  return [
    '---',
    `url: ${ISSUE_URL}`,
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
    projectNote('Acme Widgets', false),
    projectNote('Old Project', true),
  ];
  vault.notes.set(
    'Projecten/Acme Widgets/_home.md',
    '---\npm: github\ntodoist: P1\n---\n',
  );
  vault.notes.set(
    'Archief/Old Project/_home.md',
    '---\npm: github\ntodoist: P2\n---\n',
  );
  vault.notes.set(NOTE_PATH, taskNote());
  vault.notes.set(TODO_PATH, toDoNote());

  syncState.statuses.set(
    ISSUE_URL,
    taskRecord({
      url: ISSUE_URL,
      remoteId: 42,
      nodeId: 'I',
      notePath: NOTE_PATH,
      title: 'Fix the bug',
      body: hash('- [ ] Fix the bug'),
      status: 'Building',
      updatedAt: UPDATED_AT,
      labels: ['type: task'],
    }),
  );

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
        remoteId: 42,
        nodeId: 'I',
        title: 'Fix the bug',
        body: '- [ ] Fix the bug',
        state: 'open',
        updatedAt: UPDATED_AT,
        labels: ['type: task'],
      },
    ],
    cards: [
      {
        itemId: 'C1',
        type: 'ISSUE',
        issueUrl: ISSUE_URL,
        statusOptionName: 'Building',
      },
    ],
  };
  github.states.set('PVT', {
    projectId: 'PVT',
    updatedAt: UPDATED_AT,
    closed: false,
  });

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
    new VerdictResolver(),
    DONE_LANE,
  );
  const applyToTodoist = new ApplyTaskToTodoistAction(
    todoist,
    vault,
    syncState,
  );
  const applyTodoistCompletion = new ApplyTodoistCompletionAction(
    todoist,
    vault,
    syncState,
  );
  const propagateTodoistDeletions = new PropagateTodoistDeletionsAction(
    todoist,
    vault,
    syncState,
  );
  const relinkRenamedTodo = new RelinkRenamedTodoAction(vault, syncState);
  const relocateTaskStatus = new RelocateTaskStatusAction(syncState);
  const applyTodoistRemoteChanges = new ApplyTodoistRemoteChangesAction(
    todoist,
    vault,
    syncState,
    propagateStatus,
    relocateTaskStatus,
    relinkRenamedTodo,
    DONE_LANE,
  );
  const captureTodoistCreations = new CaptureTodoistCreationsAction(
    todoist,
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
  const renames = new DetectNoteRenamesAction(
    vault,
    syncState,
    relinkRenamedTodo,
    relocateTaskStatus,
  );
  const syncChecklist = new SyncChecklistAction(vault, '');
  const mirrorTodoStatus = new MirrorTodoStatusAction(vault);
  const handleDeletedNote = new HandleDeletedNoteAction(
    syncState,
    github,
    boardStatus,
    DONE_LANE,
  );
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
  );

  return { chain, vault, syncState, github, todoist };
}

// A stable fingerprint of the per-entity snapshot records, so the two runs can
// be compared without depending on Map iteration order.
function records(state: FakeSyncState): string {
  const sort = (a: string, b: string) => a.localeCompare(b);
  const statuses = [...state.statuses.values()].sort((a, b) =>
    sort(a.url, b.url),
  );
  const todoist = [...state.todoistStates.values()].sort((a, b) =>
    sort(a.notePath, b.notePath),
  );
  return JSON.stringify({ statuses, todoist }, null, 2);
}

describe('SyncProjectAction double-sync invariance', () => {
  it('performs zero writes on a second pass with no external changes', async () => {
    // Given — a fresh project with a task, a checklist-linked to-do and an
    // archived sibling, and a settled remote on both providers
    const h = harness();

    // When — the full chain runs once, reconciling the fresh state
    await h.chain.execute('Acme Widgets');
    await h.chain.execute('Old Project');
    const afterFirst = records(h.syncState);
    // The first pass genuinely reconciled: it materialised the Todoist twins
    // (and stamped the vault anchors), so the second-pass assertion is not
    // vacuous.
    expect(h.todoist.mutations.some((m) => m.startsWith('createTask:'))).toBe(
      true,
    );
    expect(h.vault.mutations.some((m) => m.startsWith('write:'))).toBe(true);

    // And — the mutator logs are cleared, then the chain runs again with no
    // external change
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];
    await h.chain.execute('Acme Widgets');
    await h.chain.execute('Old Project');

    // Then — every port mutator stayed untouched on the second pass
    expect(h.vault.mutations).toEqual([]);
    expect(h.github.mutations).toEqual([]);
    expect(h.todoist.mutations).toEqual([]);

    // And — the canonical per-entity records are identical after both runs
    expect(records(h.syncState)).toBe(afterFirst);
  });

  it('does not advance the cursor when an apply fails, and retries next pass', async () => {
    // Given — a tracked task whose remote body differs from the vault, and a
    // GitHub write that throws on the first attempt
    const h = harness();
    h.github.detail.issues[0]!.body = '- [ ] Old text';
    h.syncState.statuses.set(
      ISSUE_URL,
      taskRecord({
        url: ISSUE_URL,
        remoteId: 42,
        nodeId: 'I',
        notePath: NOTE_PATH,
        title: 'Fix the bug',
        body: hash('- [ ] Old text'),
        status: 'Building',
        updatedAt: UPDATED_AT,
      }),
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

    // When — the first pass runs and the body push fails
    await h.chain.execute('Acme Widgets');

    // Then — the cursor did not advance (the failed half is retried next pass)
    expect(h.syncState.lastUpdates.has('Acme Widgets')).toBe(false);

    // And — the second pass retries the write and advances the cursor
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
    // Given — the user set the note's status to the done lane; the remote is
    // still open and the snapshot still reads Building
    const h = harness();
    h.vault.notes.set(NOTE_PATH, doneTaskNote());

    // When — the chain runs
    await h.chain.execute('Acme Widgets');

    // Then — the done status is pushed to GitHub and the to-do completes
    expect(h.github.mutations).toContain(`setTaskState:${ISSUE_URL}:closed`);
    expect(h.vault.notes.get(TODO_PATH)).toContain('status: completed');
  });

  it('completes a done task to-dos when the status already arrived from a remote', async () => {
    // Given — the absorber already wrote the done status; the snapshot and the
    // remote agree, so the GitHub half writes nothing
    const h = harness();
    h.vault.notes.set(NOTE_PATH, doneTaskNote());
    h.syncState.statuses.set(
      ISSUE_URL,
      taskRecord({
        url: ISSUE_URL,
        remoteId: 42,
        nodeId: 'I',
        notePath: NOTE_PATH,
        title: 'Fix the bug',
        body: hash('- [ ] Fix the bug'),
        status: DONE_LANE,
        completed: true,
        updatedAt: UPDATED_AT,
        labels: ['type: task'],
      }),
    );
    h.github.detail.issues[0]!.state = 'closed';
    h.github.detail.cards[0]!.statusOptionName = DONE_LANE;

    // When — the chain runs
    await h.chain.execute('Acme Widgets');

    // Then — no GitHub write is needed, yet the to-do still completes
    expect(h.github.mutations).toEqual([]);
    expect(h.vault.notes.get(TODO_PATH)).toContain('status: completed');
  });
});
