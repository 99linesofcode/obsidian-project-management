import { describe, expect, it } from 'vitest';
import { CaptureRemoteProjectsAction } from '../../src/projects/CaptureRemoteProjectsAction.js';
import { EnsureProjectBoardAction } from '../../src/projects/EnsureProjectBoardAction.js';
import { ReconcileProjectLifecycleAction } from '../../src/projects/ReconcileProjectLifecycleAction.js';
import { ProjectData } from '../../src/shared/ProjectData.js';
import type { BoardItemData } from '../../src/projects/BoardItemData.js';
import type { CreateTodoistTaskData } from '../../src/todoist/CreateTodoistTaskData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectBoardData } from '../../src/projects/ProjectBoardData.js';
import type { ProjectDetailData } from '../../src/projects/ProjectDetailData.js';
import type { ProjectIdentityData } from '../../src/projects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../src/projects/ProjectNoteData.js';
import type { ProjectStateData } from '../../src/projects/ProjectStateData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { ProjectManagementPort } from '../../src/github/ProjectManagementPort.js';
import type { TaskManagerPort } from '../../src/todoist/TaskManagerPort.js';
import type { VaultPort } from '../../src/vault/VaultPort.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  projectNotes: ProjectNoteData[] = [];
  created: string[] = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push(path);
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }
  async modifiedTime(): Promise<string | null> {
    return null;
  }
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(): Promise<string[]> {
    return [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return this.projectNotes;
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeTaskManager implements TaskManagerPort {
  projects: TodoistProjectData[] = [];
  createCalls: string[] = [];
  async fetchProjects(): Promise<TodoistProjectData[]> {
    return this.projects;
  }
  async fetchProject(): Promise<TodoistProjectData | null> {
    return null;
  }
  async createProject(name: string): Promise<TodoistProjectData> {
    this.createCalls.push(name);
    const project: TodoistProjectData = {
      id: 'P-created',
      name,
      isArchived: false,
      createdAt: '2026-10-06T12:00:00Z',
    };
    this.projects.push(project);
    return project;
  }
  async updateProject(): Promise<void> {}
  async setProjectArchived(): Promise<void> {}
  async fetchSections(): Promise<TodoistSectionData[]> {
    return [];
  }
  async createSection(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateSection(): Promise<void> {}
  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async createTask(_input: CreateTodoistTaskData): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<void> {}
  async moveTask(): Promise<void> {}
  async setTaskCompleted(): Promise<void> {}
  async deleteTask(): Promise<void> {}
  async ensureLabel(): Promise<void> {}
}

class FakeProjectManagement implements ProjectManagementPort {
  boards: ProjectData[] = [];
  identities = new Map<string, ProjectIdentityData>();
  identityCalls: string[] = [];
  createCalls: string[] = [];
  board: ProjectBoardData = {
    projectNodeId: 'PVT_new',
    boardUrl: 'https://github.com/users/acme/projects/9',
    statusFieldId: 'PVTF_new',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  };

  async fetchViewerProjects(): Promise<ProjectData[]> {
    return this.boards;
  }
  async fetchProjectIdentity(data: {
    boardUrl: string;
  }): Promise<ProjectIdentityData | null> {
    this.identityCalls.push(data.boardUrl);
    return this.identities.get(data.boardUrl) ?? null;
  }
  async createProject(name: string): Promise<ProjectBoardData> {
    this.createCalls.push(name);
    return this.board;
  }
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectDetail(): Promise<ProjectDetailData> {
    throw new Error('not used in this test');
  }
  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<Map<string, ProjectStateData>> {
    return new Map();
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchUnpromotedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchTask(): Promise<never> {
    throw new Error('not used in this test');
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
  async deleteCard(): Promise<void> {}
  async addLabel(): Promise<void> {}
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

function todoistProject(
  overrides: Partial<TodoistProjectData> = {},
): TodoistProjectData {
  return {
    id: 'P1',
    name: 'Acme Widgets',
    isArchived: false,
    createdAt: '2026-10-05T10:00:00Z',
    ...overrides,
  };
}

// A canonical board as fetchViewerProjects returns it: the board url rides on
// mirrors.github and the creation clock on createdAt.
function board(
  name: string,
  createdAt: string,
  url = `https://github.com/users/acme/projects/${name.length}`,
): ProjectData {
  return new ProjectData(
    `PVT_${name}`,
    '',
    { github: url },
    name,
    null,
    ['Unshaped'],
    'Shipped',
    createdAt,
    null,
  );
}

function identityFor(boardUrl: string): ProjectIdentityData {
  return {
    repoUrl: '',
    repoNodeId: '',
    projectNodeId: `PVT_${boardUrl}`,
    statusFieldId: 'PVTF_new',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  };
}

function setup() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const taskManager = new FakeTaskManager();
  const projectManagement = new FakeProjectManagement();
  const action = new CaptureRemoteProjectsAction(
    projectManagement,
    taskManager,
    vault,
    syncState,
    'Shipped',
  );
  const ensureBoard = new EnsureProjectBoardAction(
    projectManagement,
    vault,
    syncState,
  );
  return { action, ensureBoard, vault, syncState, taskManager, projectManagement };
}

const cursor = '2026-09-30T00:00:00Z';

describe('CaptureRemoteProjectsAction', () => {
  describe('PRJ-2: Todoist -> vault', () => {
    it('captures a project created after the cursor and ignores an older one', async () => {
      // Given — a first-settled cursor, one old and one new Todoist project
      const h = setup();
      h.syncState.projectCursors.set('todoist', cursor);
      h.taskManager.projects = [
        todoistProject({
          id: 'P-old',
          name: 'Old Project',
          createdAt: '2026-09-01T00:00:00Z',
        }),
        todoistProject({
          id: 'P-new',
          name: 'New Project',
          createdAt: '2026-10-05T10:00:00Z',
        }),
      ];

      // When — the capture runs
      const captured = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      // Then — only the new project is adopted; the old one is never touched
      expect(captured).toEqual(['New Project']);
      expect(h.vault.created).toEqual(['Projecten/New Project/_New Project.md']);
      expect(h.vault.notes.get('Projecten/Old Project/_Old Project.md')).toBe(
        undefined,
      );
      const home = h.vault.notes.get('Projecten/New Project/_New Project.md');
      expect(home).toContain('pm: github');
      expect(home).toContain('todoist: P-new');
      // And — a registry identity record exists for the new project
      expect(await h.syncState.getIdentity('New Project')).toEqual({
        repoUrl: '',
        repoNodeId: '',
        projectNodeId: '',
        statusFieldId: '',
        statusOptions: [],
      });
    });

    it('adopts the current clock on first sight and captures nothing', async () => {
      // Given — no cursor yet and a pre-existing Todoist project
      const h = setup();
      h.taskManager.projects = [
        todoistProject({ createdAt: '2026-09-01T00:00:00Z' }),
      ];

      // When — the capture runs
      const captured = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      // Then — nothing is adopted and the cursor is seeded to the newest clock
      expect(captured).toEqual([]);
      expect(h.vault.created).toEqual([]);
      expect(await h.syncState.getProjectCursor('todoist')).toBe(
        '2026-09-01T00:00:00Z',
      );
    });

    it('never adopts a project with no creation clock', async () => {
      // Given — a project whose provider payload omits its clock
      const h = setup();
      h.syncState.projectCursors.set('todoist', cursor);
      h.taskManager.projects = [todoistProject({ createdAt: null })];

      // When — the capture runs
      const captured = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      // Then — an unknown-age project is left alone
      expect(captured).toEqual([]);
      expect(h.vault.created).toEqual([]);
    });

    it('does not adopt a project whose name already has a vault home', async () => {
      // Given — a new Todoist project whose name collides with a vault project
      const h = setup();
      h.syncState.projectCursors.set('todoist', cursor);
      h.vault.projectNotes = [
        {
          path: 'Projecten/New Project/_New Project.md',
          projectName: 'New Project',
          archivedAt: null,
          pm: 'github',
          url: '',
          board: '',
        },
      ];
      h.vault.notes.set(
        'Projecten/New Project/_New Project.md',
        '---\npm: github\n---\n',
      );
      h.taskManager.projects = [todoistProject({ name: 'New Project' })];

      // When — the capture runs
      const captured = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      // Then — the existing vault project wins; no duplicate is created
      expect(captured).toEqual([]);
      expect(h.vault.created).toEqual([]);
    });
  });

  describe('PRJ-3: GitHub -> vault', () => {
    it('captures a board created after the cursor and ignores an older one', async () => {
      // Given — a settled cursor, one old and one new board
      const h = setup();
      h.syncState.projectCursors.set('github', cursor);
      const newUrl = 'https://github.com/users/acme/projects/9';
      h.projectManagement.boards = [
        board('Old Board', '2026-09-01T00:00:00Z'),
        board('New Board', '2026-10-05T10:00:00Z', newUrl),
      ];
      h.projectManagement.identities.set(newUrl, identityFor('9'));

      // When — the capture runs
      const captured = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      // Then — only the new board is adopted
      expect(captured).toEqual(['New Board']);
      expect(h.vault.created).toEqual(['Projecten/New Board/_New Board.md']);
      const home = h.vault.notes.get('Projecten/New Board/_New Board.md');
      expect(home).toContain('pm: github');
      expect(home).toContain(`board: ${newUrl}`);
      // And — the board's identity is resolved through the board-only attach
      expect(h.projectManagement.identityCalls).toEqual([newUrl]);
      expect(await h.syncState.getIdentity('New Board')).toEqual(
        identityFor('9'),
      );
      expect(h.vault.notes.has('Projecten/Old Board/_Old Board.md')).toBe(false);
    });

    it('adopts the current clock on first sight and captures nothing', async () => {
      // Given — no cursor yet and a pre-existing board
      const h = setup();
      h.projectManagement.boards = [
        board('Existing Board', '2026-09-01T00:00:00Z'),
      ];

      // When — the capture runs
      const captured = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      // Then — nothing is adopted and the cursor is seeded
      expect(captured).toEqual([]);
      expect(h.vault.created).toEqual([]);
      expect(await h.syncState.getProjectCursor('github')).toBe(
        '2026-09-01T00:00:00Z',
      );
    });

    it('materializes the captured board to Todoist through the lifecycle', async () => {
      // Given — a new board captured into the vault
      const h = setup();
      h.syncState.projectCursors.set('github', cursor);
      const boardUrl = 'https://github.com/users/acme/projects/9';
      h.projectManagement.boards = [
        board('New Board', '2026-10-05T10:00:00Z', boardUrl),
      ];
      h.projectManagement.identities.set(boardUrl, identityFor('9'));
      await h.action.execute({ syncedAt: '2026-10-06T12:00:00Z' });
      const homePath = 'Projecten/New Board/_New Board.md';

      // When — the normal lifecycle runs for the captured project
      const lifecycle = new ReconcileProjectLifecycleAction(
        h.projectManagement,
        h.taskManager,
        h.vault,
        h.syncState,
        'Shipped',
      );
      await lifecycle.execute({
        projectName: 'New Board',
        notePath: homePath,
        locationArchived: false,
        syncedAt: '2026-10-06T12:00:00Z',
      });

      // Then — a Todoist project is created and its anchor is stamped
      expect(h.taskManager.createCalls).toEqual(['New Board']);
      expect(h.vault.notes.get(homePath)).toContain('todoist: P-created');
      // And — the board identity the capture resolved survives
      expect((await h.syncState.getIdentity('New Board'))?.projectNodeId).toBe(
        identityFor('9').projectNodeId,
      );
    });
  });

  it('is idempotent: a second pass over a captured project captures nothing', async () => {
    // Given — a new Todoist project captured once
    const h = setup();
    h.syncState.projectCursors.set('todoist', cursor);
    h.taskManager.projects = [
      todoistProject({
        id: 'P-new',
        name: 'New Project',
        createdAt: '2026-10-05T10:00:00Z',
      }),
    ];
    await h.action.execute({ syncedAt: '2026-10-06T12:00:00Z' });
    h.vault.created = [];

    // And — the project now appears as a vault home the way discovery would
    // report it (the note exists in the fake's map).
    h.vault.projectNotes = [
      {
        path: 'Projecten/New Project/_New Project.md',
        projectName: 'New Project',
        archivedAt: null,
        pm: 'github',
        url: '',
        board: '',
      },
    ];

    // When — a second pass runs
    const captured = await h.action.execute({
      syncedAt: '2026-10-06T12:05:00Z',
    });

    // Then — nothing is created again
    expect(captured).toEqual([]);
    expect(h.vault.created).toEqual([]);
  });

  it('splices a Todoist-captured project all the way to a board (PRJ-2 + PRJ-1)', async () => {
    // Given — a new Todoist project and a settled cursor
    const h = setup();
    h.syncState.projectCursors.set('todoist', cursor);
    h.taskManager.projects = [
      todoistProject({
        id: 'P-new',
        name: 'New Project',
        createdAt: '2026-10-05T10:00:00Z',
      }),
    ];

    // When — the capture runs, then the board leg completes
    await h.action.execute({ syncedAt: '2026-10-06T12:00:00Z' });
    await h.ensureBoard.execute({
      projectName: 'New Project',
      notePath: 'Projecten/New Project/_New Project.md',
    });

    // Then — the vault project carries both anchors and a board identity
    const home = h.vault.notes.get('Projecten/New Project/_New Project.md');
    expect(home).toContain('todoist: P-new');
    expect(home).toContain(
      'board: https://github.com/users/acme/projects/9',
    );
    expect(await h.syncState.getIdentity('New Project')).toEqual({
      repoUrl: '',
      repoNodeId: '',
      projectNodeId: 'PVT_new',
      statusFieldId: 'PVTF_new',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    });
  });
});
