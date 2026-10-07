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
import type { SyncHalfFactory } from '../../src/sync/SyncHalves.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';
import { projectNoteFromCache } from '../../src/vault/projectNoteFromCache.js';

const DONE_LANE = 'Shipped';
const PROJECT = 'Acme Widgets';
const NOTE_PATH = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const ISSUE_URL = 'https://github.com/acme/widgets/issues/42';
const UPDATED_AT = '2026-09-18T11:00:00Z';
const ENTITY_ID = 'uuid-42';
const WORK_PROJECT = 'P-work';
const PERSONAL_PROJECT = 'P-personal';

class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();
  notes = new Map<string, string>();
  projectNotes: ProjectNoteData[] = [];
  mutations: string[] = [];

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
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
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchUnpromotedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchTask(): Promise<GithubTaskData> {
    throw new Error('not used');
  }
  async updateTask(): Promise<GithubTaskData> {
    throw new Error('not used');
  }
  async setTaskState(): Promise<GithubTaskData> {
    throw new Error('not used');
  }
  async fetchBoardItems(): Promise<BoardItemData[]> {
    return this.detail.cards;
  }
  async setBoardStatus(_status: BoardStatusData): Promise<void> {}
  async addBoardItem(): Promise<void> {}
  async deleteCard(): Promise<void> {}
  async addLabel(): Promise<void> {}
  async fetchProject(): Promise<never> {
    throw new Error('not used');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used');
  }
  async promoteCard(): Promise<GithubTaskData> {
    throw new Error('not used');
  }
  async createProject(): Promise<never> {
    throw new Error('not used');
  }
  async fetchRepoBoards(): Promise<never> {
    throw new Error('not used');
  }
  async createBoardWithStatusField(): Promise<never> {
    throw new Error('not used');
  }
  async listRepoLabels(): Promise<never> {
    throw new Error('not used');
  }
  async createRepoLabel(): Promise<never> {
    throw new Error('not used');
  }
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used');
  }
  async adoptBoard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

// A task manager that honours the projectId, so the two connections' fetches
// are genuinely independent.
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
    return project;
  }
  async updateProject(): Promise<void> {}
  async setProjectArchived(): Promise<void> {}
  async fetchSections(projectId: string): Promise<TodoistSectionData[]> {
    return this.sections.filter((section) => section.projectId === projectId);
  }
  async createSection(
    projectId: string,
    name: string,
  ): Promise<TodoistSectionData> {
    const section = { id: `S${++this.nextId}`, projectId, name };
    this.sections.push(section);
    return section;
  }
  async updateSection(): Promise<void> {}
  async fetchActiveTasks(projectId: string): Promise<TodoistTaskData[]> {
    return this.active.filter((task) => task.projectId === projectId);
  }
  async fetchCompletedTasks(projectId: string): Promise<TodoistTaskData[]> {
    return this.completed.filter((task) => task.projectId === projectId);
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
    this.mutations.push(`createTask:${input.projectId}:${task.content}`);
    return task;
  }
  async updateTask(): Promise<void> {}
  async moveTask(): Promise<void> {}
  async setTaskCompleted(): Promise<void> {}
  async deleteTask(): Promise<void> {}
  async ensureLabel(): Promise<void> {}
}

function taskNote(): string {
  return [
    '---',
    'type: task',
    'status: Building',
    'affiliation: ["[[Acme Widgets]]"]',
    '---',
    '',
  ].join('\n');
}

function projectNote(): ProjectNoteData {
  const note = projectNoteFromCache(`Projecten/${PROJECT}/_${PROJECT}.md`, {
    connections: {
      github: { tool: 'github', project: 'https://github.com/acme/widgets' },
      'todoist-work': { tool: 'todoist', project: WORK_PROJECT },
      'todoist-personal': { tool: 'todoist', project: PERSONAL_PROJECT },
    },
  });
  if (note === null) {
    throw new Error('the two-connection project note did not parse');
  }
  return note;
}

function projectNoteContent(): string {
  return [
    '---',
    'connections:',
    '  github:',
    '    tool: github',
    '    project: https://github.com/acme/widgets',
    '  todoist-work:',
    '    tool: todoist',
    `    project: ${WORK_PROJECT}`,
    '  todoist-personal:',
    '    tool: todoist',
    `    project: ${PERSONAL_PROJECT}`,
    '---',
    '',
  ].join('\n');
}

function githubBase(): TaskData {
  return taskData({
    id: ENTITY_ID,
    notePath: NOTE_PATH,
    title: 'Fix the bug',
    body: hash(''),
    status: 'Building',
    updatedAt: UPDATED_AT,
    type: 'task',
  });
}

interface Harness {
  chain: SyncProjectAction;
  vault: FakeVault;
  syncState: FakeSyncState;
  github: FakeProjectManagement;
  todoist: FakeTaskManager;
  workHalf: SyncTodoistTasksAction;
  personalHalf: SyncTodoistTasksAction;
}

function harness(): Harness {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const github = new FakeProjectManagement();
  const todoist = new FakeTaskManager();

  vault.projectNotes = [projectNote()];
  vault.notes.set(`Projecten/${PROJECT}/_${PROJECT}.md`, projectNoteContent());
  vault.notes.set(NOTE_PATH, taskNote());

  syncState.seed(entityRecord({ id: ENTITY_ID, notePath: NOTE_PATH }), {
    github: { handle: ISSUE_URL, base: githubBase() },
  });
  syncState.identities.set(PROJECT, {
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
        body: '',
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

  todoist.projects.set(WORK_PROJECT, {
    id: WORK_PROJECT,
    name: PROJECT,
    isArchived: false,
  });
  todoist.projects.set(PERSONAL_PROJECT, {
    id: PERSONAL_PROJECT,
    name: PROJECT,
    isArchived: false,
  });
  todoist.sections = [
    { id: 'S1', projectId: WORK_PROJECT, name: 'Unshaped' },
    { id: 'S2', projectId: WORK_PROJECT, name: 'Building' },
    { id: 'S3', projectId: WORK_PROJECT, name: DONE_LANE },
    { id: 'S4', projectId: PERSONAL_PROJECT, name: 'Unshaped' },
    { id: 'S5', projectId: PERSONAL_PROJECT, name: 'Building' },
    { id: 'S6', projectId: PERSONAL_PROJECT, name: DONE_LANE },
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

  const workHalf = new SyncTodoistTasksAction(
    'todoist-work',
    WORK_PROJECT,
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
  const personalHalf = new SyncTodoistTasksAction(
    'todoist-personal',
    PERSONAL_PROJECT,
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

  const halfFactory: SyncHalfFactory = {
    create: (slug, connection) => {
      if (connection.tool === 'github') {
        return new SyncGithubTasksAction(
          slug,
          github,
          syncState,
          vault,
          applyToGithub,
          applyToVault,
          new VerdictResolver(DONE_LANE),
          DONE_LANE,
        );
      }
      if (connection.tool === 'todoist') {
        return slug === 'todoist-work' ? workHalf : personalHalf;
      }
      return null;
    },
  };

  const lifecycle = new ReconcileProjectLifecycleAction(
    github,
    todoist,
    vault,
    syncState,
    DONE_LANE,
  );
  const chain = new SyncProjectAction(
    vault,
    syncState,
    new ProbeProjectsAction(github, syncState),
    lifecycle,
    new DetectNoteRenamesAction(vault, syncState),
    halfFactory,
    completeTaskCascade,
    new SyncChecklistAction(vault, ''),
    new MirrorTodoStatusAction(vault),
    new HandleDeletedNoteAction(syncState, github, DONE_LANE),
  );

  return {
    chain,
    vault,
    syncState,
    github,
    todoist,
    workHalf,
    personalHalf,
  };
}

describe('two task-manager connections sync independently', () => {
  it('keys each connection port by its own slug and project', async () => {
    const h = harness();

    await h.chain.execute(PROJECT);

    expect(
      await h.syncState.getPortState(PROJECT, 'todoist-work'),
    ).toMatchObject({ provider: 'todoist', project: WORK_PROJECT });
    expect(
      await h.syncState.getPortState(PROJECT, 'todoist-personal'),
    ).toMatchObject({ provider: 'todoist', project: PERSONAL_PROJECT });
  });

  it('projects the task to both connections with separate mirror items', async () => {
    const h = harness();

    await h.chain.execute(PROJECT);

    const work = await h.syncState.findMirrorItemByEntity(
      'todoist-work',
      ENTITY_ID,
    );
    const personal = await h.syncState.findMirrorItemByEntity(
      'todoist-personal',
      ENTITY_ID,
    );
    expect(work).not.toBeNull();
    expect(personal).not.toBeNull();
    expect(work!.handle).not.toBe(personal!.handle);
    expect(
      h.todoist.active.filter((task) => task.projectId === WORK_PROJECT),
    ).toHaveLength(1);
    expect(
      h.todoist.active.filter((task) => task.projectId === PERSONAL_PROJECT),
    ).toHaveLength(1);
  });

  it('never advances one connection base from another connection fact', async () => {
    const h = harness();
    await h.chain.execute(PROJECT);

    const workBefore = await h.syncState.findMirrorItemByEntity(
      'todoist-work',
      ENTITY_ID,
    );
    const personalBefore = await h.syncState.findMirrorItemByEntity(
      'todoist-personal',
      ENTITY_ID,
    );
    // A fact on the work connection: its twin is completed remotely.
    const workTask = h.todoist.active.find(
      (task) => task.id === workBefore!.handle,
    )!;
    workTask.isCompleted = true;
    workTask.completedAt = UPDATED_AT;
    h.todoist.active = h.todoist.active.filter(
      (task) => task.id !== workTask.id,
    );
    h.todoist.completed.push(workTask);

    // Run ONLY the work half: its absorption advances the work base, never the
    // personal base.
    await h.workHalf.execute({
      projectName: PROJECT,
      syncedAt: new Date().toISOString(),
      includeBoard: false,
      connections: h.vault.projectNotes[0]!.connections,
    });

    const workAfter = await h.syncState.findMirrorItemByEntity(
      'todoist-work',
      ENTITY_ID,
    );
    const personalAfter = await h.syncState.findMirrorItemByEntity(
      'todoist-personal',
      ENTITY_ID,
    );
    expect(workAfter!.item.base?.canonical()).not.toBe(
      workBefore!.item.base?.canonical(),
    );
    expect(personalAfter!.item.base?.canonical()).toBe(
      personalBefore!.item.base?.canonical(),
    );
  });
});
