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
  async setBoardStatus(
    _projectNodeId: string,
    _statusFieldId: string,
    issueUrl: string,
    statusOptionId: string,
  ): Promise<void> {
    this.mutations.push(`setBoardStatus:${issueUrl}:${statusOptionId}`);
    const card = this.detail.cards.find(
      (candidate) => candidate.issueUrl === issueUrl,
    );
    const name = this.optionNames[statusOptionId];
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
    const task =
      this.active.find((candidate) => candidate.id === id) ??
      this.completed.find((candidate) => candidate.id === id);
    if (task) {
      task.isCompleted = completed;
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

// The resurrection loop: a trashed note must not return. The sweep deletes the
// card, closes the issue and removes the record; the untracked-closed gate then
// keeps the closed issue from re-materialising on every later poll, and the
// Todoist deletion propagation keeps the twin gone.
describe('SyncProjectAction deletion sweep', () => {
  it('does not resurrect a deleted task after the sweep', async () => {
    // Given — a settled project with a task note, its open issue, its card and
    // its Todoist twin
    const h = harness();
    await h.chain.execute('Acme Widgets');
    expect(h.syncState.statuses.has(ISSUE_URL)).toBe(true);
    expect(h.syncState.todoistStates.has(NOTE_PATH)).toBe(true);

    // And — the user deletes the task note
    h.vault.notes.delete(NOTE_PATH);
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];

    // When — the sweep pass runs
    await h.chain.execute('Acme Widgets');

    // Then — the card is deleted, the issue closed and the record removed
    expect(h.github.mutations).toContain(`deleteCard:PVT:${ISSUE_URL}`);
    expect(h.github.mutations).toContain(`setTaskState:${ISSUE_URL}:closed`);
    expect(h.syncState.statuses.has(ISSUE_URL)).toBe(false);
    expect(h.github.detail.cards).toEqual([]);

    // And — the Todoist twin is deleted (the API cascades the to-do subtask
    // away with it) and both records are evicted
    expect(h.todoist.mutations).toContain(`deleteTask:${TASK_TWIN}`);
    expect(h.todoist.active).toEqual([]);
    expect(h.todoist.completed).toEqual([]);
    expect(h.syncState.todoistStates.has(NOTE_PATH)).toBe(false);
    expect(h.syncState.todoistStates.has(TODO_PATH)).toBe(false);

    // And — the mutator logs are cleared, then two more passes run
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];
    await h.chain.execute('Acme Widgets');
    await h.chain.execute('Acme Widgets');

    // Then — the note stays gone, no card or twin is recreated, and no port is
    // written after the sweep
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

// dt-17 churn fix: once a task/to-do has completed and its snapshot record
// carries the stamp, no later pass may re-complete, re-archive or re-write it —
// even after the completed-since window has aged past the completion and the
// twin is returned by neither fetch. The mirror policy (dt-22) keeps the
// completed twin; the settle gate stops the recreate-every-tick loop.
describe('SyncProjectAction completion settle', () => {
  it('performs zero completion writes on N passes after a completion settles', async () => {
    // Given — a task note in the done lane with its checklist line already
    // checked, its issue closed and its card in the done lane, and a snapshot
    // that already reads done — so the only remaining work is completing the
    // still-open to-do and materialising the twins
    const h = harness();
    h.vault.notes.set(NOTE_PATH, doneTaskNote().replace('- [ ]', '- [x]'));
    h.syncState.statuses.set(
      ISSUE_URL,
      taskRecord({
        url: ISSUE_URL,
        remoteId: 42,
        nodeId: 'I',
        notePath: NOTE_PATH,
        title: 'Fix the bug',
        body: hash('- [x] Fix the bug'),
        status: DONE_LANE,
        completed: true,
        updatedAt: UPDATED_AT,
        labels: ['type: task'],
      }),
    );
    h.github.detail.issues[0]!.body = '- [x] Fix the bug';
    h.github.detail.issues[0]!.state = 'closed';
    h.github.detail.cards[0]!.statusOptionName = DONE_LANE;

    // When — the chain runs once to settlement: the first pass creates and
    // completes both the task and the to-do twins
    await h.chain.execute('Acme Widgets');
    const completionWrites = h.todoist.mutations.filter((m) =>
      m.startsWith('setTaskCompleted:'),
    );
    expect(completionWrites.length).toBeGreaterThan(0);
    expect(completionWrites.every((m) => m.endsWith(':true'))).toBe(true);

    // And — the completed-since window ages past the completions (the cursor
    // advanced), so neither twin is returned by either fetch anymore
    h.todoist.expireCompleted();
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];

    // And — N further passes with no external change
    for (let pass = 0; pass < 3; pass++) {
      await h.chain.execute('Acme Widgets');
    }

    // Then — the twins are never re-completed, re-created or re-archived, and
    // no port is written at all: the completed twins persist (dt-22) and the
    // settle gate holds (dt-17)
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
    // Given — a settled open task
    const h = harness();
    await h.chain.execute('Acme Widgets');

    // And — the user closes the issue; GitHub's "item closed" workflow moves
    // the card to the done lane
    h.github.detail.issues[0]!.state = 'closed';
    h.github.detail.cards[0]!.statusOptionName = DONE_LANE;
    touch(h);

    // When — the chain runs
    await h.chain.execute('Acme Widgets');

    // Then — the note follows the card into the done lane
    expect(h.vault.notes.get(NOTE_PATH)).toContain(`status: ${DONE_LANE}`);

    // And — both twins settle to done
    expect(h.todoist.completed.map((task) => task.id)).toContain(TASK_TWIN);
    expect(h.todoist.completed.map((task) => task.id)).toContain(TODO_TWIN);

    // And — the issue is already closed and the card already in done, so the
    // GitHub half writes nothing
    expect(h.github.mutations).toEqual([]);
  });

  it('reopens the note and its task twin, and leaves the to-dos completed', async () => {
    // Given — a settled open task, then completed through a GitHub close
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.github.detail.issues[0]!.state = 'closed';
    h.github.detail.cards[0]!.statusOptionName = DONE_LANE;
    touch(h);
    await h.chain.execute('Acme Widgets');
    // And — a settle pass pushes the cascade's checked line onto the issue, so
    // the done state is fully converged before the reopen
    await h.chain.execute('Acme Widgets');
    expect(h.vault.notes.get(NOTE_PATH)).toContain(`status: ${DONE_LANE}`);
    expect(h.github.detail.issues[0]!.body).toBe('- [x] Fix the bug');

    // And — the user reopens the issue; GitHub's "item reopened" workflow moves
    // the card back to the default lane
    h.github.detail.issues[0]!.state = 'open';
    h.github.detail.cards[0]!.statusOptionName = 'Unshaped';
    touch(h, '2026-09-18T13:00:00Z');

    // When — the chain runs, then a settle pass with no external change
    await h.chain.execute('Acme Widgets');
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];
    await h.chain.execute('Acme Widgets');

    // Then — the note left the done lane for the default lane and stays there
    expect(h.vault.notes.get(NOTE_PATH)).toContain('status: Unshaped');

    // And — the task twin reopened
    expect(h.todoist.active.map((task) => task.id)).toContain(TASK_TWIN);

    // And — the asymmetric rule holds: the task reopen never auto-reopens its
    // to-dos, so the to-do twin stays completed
    expect(h.todoist.completed.map((task) => task.id)).toContain(TODO_TWIN);

    // And — the settle pass converged with zero writes on any surface
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
    // Given — a settled task whose checklist item is checked on the issue
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.github.detail.issues[0]!.body = '- [x] Fix the bug';
    touch(h);

    // When — the chain runs
    await h.chain.execute('Acme Widgets');

    // Then — the note's checklist line is checked
    expect(h.vault.notes.get(NOTE_PATH)).toContain(
      `- [x] [[${TODO_PATH}|Fix the bug]]`,
    );

    // And — the to-do note is completed
    expect(h.vault.notes.get(TODO_PATH)).toContain('status: completed');

    // And — the Todoist subtask is checked
    expect(h.todoist.completed.map((task) => task.id)).toContain(TODO_TWIN);
  });

  it('reopens the to-do and unchecks the twin when an item is unchecked', async () => {
    // Given — a settled task whose item was checked on the issue
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.github.detail.issues[0]!.body = '- [x] Fix the bug';
    touch(h);
    await h.chain.execute('Acme Widgets');
    expect(h.vault.notes.get(TODO_PATH)).toContain('status: completed');

    // And — the user unchecks it again
    h.github.detail.issues[0]!.body = '- [ ] Fix the bug';
    touch(h, '2026-09-18T13:00:00Z');

    // When — the chain runs
    await h.chain.execute('Acme Widgets');

    // Then — the note's line is unchecked
    expect(h.vault.notes.get(NOTE_PATH)).toContain(
      `- [ ] [[${TODO_PATH}|Fix the bug]]`,
    );

    // And — the to-do note reopened
    expect(h.vault.notes.get(TODO_PATH)).toContain('status: open');

    // And — the Todoist subtask is unchecked
    expect(h.todoist.active.map((task) => task.id)).toContain(TODO_TWIN);
    expect(h.todoist.completed.map((task) => task.id)).not.toContain(TODO_TWIN);
  });

  it('trashes the to-do and deletes its twin when an item is removed', async () => {
    // Given — a settled task whose checklist item is removed from the issue
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.github.detail.issues[0]!.body = 'No items left.';
    touch(h);

    // When — the chain runs
    await h.chain.execute('Acme Widgets');

    // Then — the note no longer carries the line
    expect(h.vault.notes.get(NOTE_PATH)).toContain('No items left.');

    // And — the to-do note is trashed
    expect(h.vault.notes.has(TODO_PATH)).toBe(false);

    // And — its Todoist twin is deleted and its record evicted
    expect(h.todoist.mutations).toContain(`deleteTask:${TODO_TWIN}`);
    expect(h.todoist.active.map((task) => task.id)).not.toContain(TODO_TWIN);
    expect(h.syncState.todoistStates.has(TODO_PATH)).toBe(false);

    // And — nothing else is touched: the task twin and its record survive
    expect(h.todoist.active.map((task) => task.id)).toContain(TASK_TWIN);
    expect(h.syncState.todoistStates.has(NOTE_PATH)).toBe(true);
  });
});

// Reopen after the deletion sweep: fix A materialises only OPEN untracked
// issues, so reopening the swept issue makes it materialise again — a fresh
// note, a NEW board card and a recreated Todoist twin — and the system then
// converges (the next pass writes nothing).
describe('SyncProjectAction reopen after delete', () => {
  it('re-materialises the note, adds a new card and recreates the twin when the issue is reopened', async () => {
    // Given — a settled task whose note is deleted and swept
    const h = harness();
    await h.chain.execute('Acme Widgets');
    h.vault.notes.delete(NOTE_PATH);
    await h.chain.execute('Acme Widgets');
    expect(h.syncState.statuses.has(ISSUE_URL)).toBe(false);
    expect(h.github.detail.cards).toEqual([]);
    expect(h.todoist.active).toEqual([]);

    // And — the user reopens the swept issue on GitHub
    h.github.detail.issues[0]!.state = 'open';
    touch(h, '2026-09-18T13:00:00Z');

    // When — the chain runs
    await h.chain.execute('Acme Widgets');

    // Then — the open untracked issue materialises a fresh note
    expect(h.vault.notes.has(NOTE_PATH)).toBe(true);

    // And — a NEW board card is added in the default lane
    expect(h.github.mutations).toContain(`addBoardItem:${ISSUE_URL}`);
    expect(h.github.detail.cards).toHaveLength(1);
    expect(h.github.detail.cards[0]!.statusOptionName).toBe('Unshaped');

    // And — the task and its to-do twin are recreated by the projection. The
    // to-do note gets a `-2` slug: the sweep leaves the old to-do note orphaned
    // (only its twin is cascaded away), so the checklist promotes the item at
    // the next free slug and then trashes the orphan in the same pass.
    expect(h.todoist.active).toHaveLength(2);
    const taskTwin = h.todoist.active.find((task) => task.parentId === null);
    expect(taskTwin).toBeDefined();
    expect(
      h.todoist.active.some((task) => task.parentId === taskTwin!.id),
    ).toBe(true);
    expect(h.syncState.todoistStates.has(NOTE_PATH)).toBe(true);
    expect(
      [...h.syncState.todoistStates.keys()].some((path) =>
        path.startsWith('Projecten/Acme Widgets/todos/'),
      ),
    ).toBe(true);

    // And — a further pass with no external change writes nothing
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
    // Given — a settled project plus a captured draft note whose completed twin
    // is anchored by a stale record
    const h = harness();
    await h.chain.execute('Acme Widgets');
    const capturedPath = 'Projecten/Acme Widgets/taken/captured-draft.md';
    const capturedTwin = 'T9';
    h.vault.notes.set(
      capturedPath,
      [
        '---',
        'status: Unshaped',
        'affiliation: ["[[Acme Widgets]]"]',
        `todoist: ${capturedTwin}`,
        '---',
        '- [ ] Captured draft',
      ].join('\n'),
    );
    h.syncState.todoistStates.set(
      capturedPath,
      taskRecord({
        todoistId: capturedTwin,
        notePath: capturedPath,
        title: 'Captured draft',
        status: 'Unshaped',
        completed: true,
      }),
    );
    h.todoist.completed.push({
      id: capturedTwin,
      projectId: 'P1',
      sectionId: 'S1',
      parentId: null,
      content: 'Captured draft',
      labels: ['task'],
      isCompleted: true,
      url: '',
    });

    // And — the captured note vanishes
    h.vault.notes.delete(capturedPath);
    h.vault.mutations = [];
    h.github.mutations = [];
    h.todoist.mutations = [];

    // When — the chain runs once to settle the orphan
    await h.chain.execute('Acme Widgets');

    // Then — the stale record is evicted and the twin deleted
    expect(h.syncState.todoistStates.has(capturedPath)).toBe(false);
    expect(h.todoist.active.map((task) => task.id)).not.toContain(capturedTwin);
    expect(h.todoist.completed.map((task) => task.id)).not.toContain(
      capturedTwin,
    );

    // And — N further passes create no new notes, twins or records, and write
    // nothing on any surface
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
    expect(h.syncState.todoistStates.has(capturedPath)).toBe(false);
    expect(h.vault.mutations).toEqual([]);
    expect(h.github.mutations).toEqual([]);
    expect(h.todoist.mutations).toEqual([]);
  });
});
