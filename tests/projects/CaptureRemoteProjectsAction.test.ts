import { describe, expect, it } from 'vitest';
import { CaptureRemoteProjectsAction } from '../../src/projects/CaptureRemoteProjectsAction.js';
import { EnsureProjectBoardAction } from '../../src/projects/EnsureProjectBoardAction.js';
import { ReconcileProjectLifecycleAction } from '../../src/projects/ReconcileProjectLifecycleAction.js';
import { ProjectAddressing } from '../../src/core/data/ProjectAddressing.js';
import type { ProjectCandidate } from '../../src/core/data/ProjectCandidate.js';
import { ProjectDiscovery } from '../../src/core/data/ProjectDiscovery.js';
import type { ProjectSetupPort } from '../../src/core/ports/ProjectSetupPort.js';
import { ProjectData } from '../../src/shared/ProjectData.js';
import type { BoardItemData } from '../../src/shared/BoardItemData.js';
import type { CreateTodoistTaskData } from '../../src/todoist/CreateTodoistTaskData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectBoardData } from '../../src/shared/ProjectBoardData.js';
import type { ProjectDetailData } from '../../src/shared/ProjectDetailData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { ProjectStateData } from '../../src/shared/ProjectStateData.js';
import type { RemoteBoardData } from '../../src/shared/RemoteBoardData.js';
import type { RepositoryBoardsData } from '../../src/shared/RepoBoardData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import type { TaskManagerPort } from '../../src/shared/TaskManagerPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
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
  boardRepositories = new Map<string, string[]>();
  identities = new Map<string, ProjectIdentityData>();
  identityCalls: string[] = [];
  createCalls: string[] = [];
  board: ProjectBoardData = {
    projectNodeId: 'PVT_new',
    boardUrl: 'https://github.com/users/acme/projects/9',
    statusFieldId: 'PVTF_new',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  };

  async fetchViewerProjects(): Promise<RemoteBoardData[]> {
    return this.boards.map((project) => ({
      project,
      repoUrls: this.boardRepositories.get(project.mirrors.github ?? '') ?? [],
    }));
  }
  async adoptBoard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectIdentity(data: {
    repoUrl: string;
    boardUrl: string;
  }): Promise<ProjectIdentityData | null> {
    this.identityCalls.push(data.boardUrl);
    const identity = this.identities.get(data.boardUrl);
    return identity === undefined
      ? null
      : { ...identity, repoUrl: data.repoUrl };
  }
  async createProject(name: string): Promise<ProjectBoardData> {
    this.createCalls.push(name);
    return this.board;
  }
  repoBoards: RepositoryBoardsData = { repoNodeId: 'R_kgDOAAAA', boards: [] };
  boardCreateCalls: Array<{ repoUrl: string; statusOptions: string[] }> = [];
  async fetchRepoBoards(): Promise<RepositoryBoardsData> {
    return this.repoBoards;
  }
  async createBoardWithStatusField(
    repoUrl: string,
    statusOptions: string[],
  ): Promise<ProjectBoardData> {
    this.boardCreateCalls.push({ repoUrl, statusOptions });
    return this.board;
  }
  async listRepoLabels(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createRepoLabel(): Promise<never> {
    throw new Error('not used in this test');
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

class FakeSetup implements ProjectSetupPort {
  discovery: ProjectDiscovery = new ProjectDiscovery({
    targetHandle: 'R_kgDOAAAA',
    projects: [],
  });
  createCalls: Array<{
    target: string;
    name: string;
    statusOptions: string[];
  }> = [];
  created = new ProjectAddressing({
    projectHandle: 'PVT_new',
    statusFieldHandle: 'PVTF_new',
    statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
  });

  async discoverProjects(): Promise<ProjectDiscovery> {
    return this.discovery;
  }
  async readProjectAddressing(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createProjectWithStatus(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing> {
    this.createCalls.push({ target, name, statusOptions: [...statusOptions] });
    return this.created;
  }
  async adoptProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async listProjects(): Promise<readonly ProjectCandidate[]> {
    return [];
  }
  async probeProjects(): Promise<never> {
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
  const setup = new FakeSetup();
  const action = new CaptureRemoteProjectsAction(
    projectManagement,
    taskManager,
    vault,
    syncState,
    'Shipped',
  );
  const ensureBoard = new EnsureProjectBoardAction(setup, syncState, [
    'Unshaped',
  ]);
  return {
    action,
    ensureBoard,
    vault,
    syncState,
    taskManager,
    projectManagement,
    setup,
  };
}

const cursor = '2026-09-30T00:00:00Z';

const TODOIST_HOME = [
  '---',
  'connections:',
  '  todoist:',
  '    tool: todoist',
  '    project: "P-new"',
  '---',
  '',
  '# New Project',
  '',
].join('\n');

const GITHUB_HOME = [
  '---',
  'connections:',
  '  github:',
  '    tool: github',
  '    project: "https://github.com/acme/widgets"',
  '---',
  '',
  '# New Board',
  '',
].join('\n');

describe('PRJ-3 — a board born on GitHub becomes a vault project', () => {
  describe('PRJ-2: Todoist -> vault', () => {
    it('captures a project created after the cursor as a todoist connection and ignores an older one', async () => {
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

      const { captured, errors } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual(['New Project']);
      expect(errors).toEqual([]);
      expect(h.vault.created).toEqual([
        'Projecten/New Project/_New Project.md',
      ]);
      expect(h.vault.notes.get('Projecten/Old Project/_Old Project.md')).toBe(
        undefined,
      );
      const home = h.vault.notes.get('Projecten/New Project/_New Project.md');
      expect(home).toBe(TODOIST_HOME);
      expect(await h.syncState.getIdentity('New Project', 'todoist')).toEqual({
        repoUrl: '',
        repoNodeId: '',
        projectNodeId: '',
        statusFieldId: '',
        statusOptions: [],
      });
    });

    it('never writes the legacy top-level properties into a captured note', async () => {
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

      const home = h.vault.notes.get('Projecten/New Project/_New Project.md')!;
      const lines = home.split('\n');
      const closing = lines.indexOf('---', 1);
      const properties = lines
        .slice(1, closing)
        .filter((line) => !line.startsWith(' '));
      expect(properties).toEqual(['connections:']);
    });

    it('adopts the current clock on first sight and captures nothing', async () => {
      const h = setup();
      h.taskManager.projects = [
        todoistProject({ createdAt: '2026-09-01T00:00:00Z' }),
      ];

      const { captured, errors } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual([]);
      expect(errors).toEqual([]);
      expect(h.vault.created).toEqual([]);
      expect(await h.syncState.getProjectCursor('todoist')).toBe(
        '2026-09-01T00:00:00Z',
      );
    });

    it('never adopts a project with no creation clock', async () => {
      const h = setup();
      h.syncState.projectCursors.set('todoist', cursor);
      h.taskManager.projects = [todoistProject({ createdAt: null })];

      const { captured, errors } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual([]);
      expect(errors).toEqual([]);
      expect(h.vault.created).toEqual([]);
    });

    it('does not adopt a project whose name already has a vault home', async () => {
      const h = setup();
      h.syncState.projectCursors.set('todoist', cursor);
      h.vault.projectNotes = [
        {
          path: 'Projecten/New Project/_New Project.md',
          projectName: 'New Project',
          archivedAt: null,
          connections: { todoist: { tool: 'todoist', project: 'P1' } },
          connectionErrors: [],
        },
      ];
      h.taskManager.projects = [todoistProject({ name: 'New Project' })];

      const { captured } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual([]);
      expect(h.vault.created).toEqual([]);
    });

    it('does not adopt a project whose todoist connection already has a vault home', async () => {
      const h = setup();
      h.syncState.projectCursors.set('todoist', cursor);
      h.vault.projectNotes = [
        {
          path: 'Projecten/Other Name/_Other Name.md',
          projectName: 'Other Name',
          archivedAt: null,
          connections: { todoist: { tool: 'todoist', project: 'P-new' } },
          connectionErrors: [],
        },
      ];
      h.taskManager.projects = [
        todoistProject({
          id: 'P-new',
          name: 'New Project',
          createdAt: '2026-10-05T10:00:00Z',
        }),
      ];

      const { captured } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual([]);
      expect(h.vault.created).toEqual([]);
    });
  });

  describe('PRJ-3: GitHub -> vault', () => {
    it('captures a board with exactly one linked repository and ignores an older one', async () => {
      const h = setup();
      h.syncState.projectCursors.set('github', cursor);
      const newUrl = 'https://github.com/users/acme/projects/9';
      const repoUrl = 'https://github.com/acme/widgets';
      h.projectManagement.boards = [
        board('Old Board', '2026-09-01T00:00:00Z'),
        board('New Board', '2026-10-05T10:00:00Z', newUrl),
      ];
      h.projectManagement.boardRepositories.set(newUrl, [repoUrl]);
      h.projectManagement.identities.set(newUrl, identityFor('9'));

      const { captured, errors } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual(['New Board']);
      expect(errors).toEqual([]);
      expect(h.vault.created).toEqual(['Projecten/New Board/_New Board.md']);
      const home = h.vault.notes.get('Projecten/New Board/_New Board.md');
      expect(home).toBe(GITHUB_HOME);
      expect(h.projectManagement.identityCalls).toEqual([newUrl]);
      expect(await h.syncState.getIdentity('New Board', 'github')).toEqual({
        ...identityFor('9'),
        repoUrl,
      });
      expect(h.vault.notes.has('Projecten/Old Board/_Old Board.md')).toBe(
        false,
      );
    });

    it('collects an error and captures nothing when the board links no repository', async () => {
      const h = setup();
      h.syncState.projectCursors.set('github', cursor);
      const boardUrl = 'https://github.com/users/acme/projects/9';
      h.projectManagement.boards = [
        board('New Board', '2026-10-05T10:00:00Z', boardUrl),
      ];
      h.projectManagement.identities.set(boardUrl, identityFor('9'));

      const { captured, errors } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(h.vault.created).toEqual([]);
      expect(h.syncState.projectCursors.get('github')).toBe(cursor);
    });

    it('collects an error and captures nothing when the board links several repositories', async () => {
      const h = setup();
      h.syncState.projectCursors.set('github', cursor);
      const boardUrl = 'https://github.com/users/acme/projects/9';
      h.projectManagement.boards = [
        board('New Board', '2026-10-05T10:00:00Z', boardUrl),
      ];
      h.projectManagement.boardRepositories.set(boardUrl, [
        'https://github.com/acme/one',
        'https://github.com/acme/two',
      ]);
      h.projectManagement.identities.set(boardUrl, identityFor('9'));

      const { captured, errors } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(h.vault.created).toEqual([]);
      expect(h.syncState.projectCursors.get('github')).toBe(cursor);
    });

    it('does not adopt a board whose linked repository already has a vault home', async () => {
      const h = setup();
      h.syncState.projectCursors.set('github', cursor);
      const boardUrl = 'https://github.com/users/acme/projects/9';
      const repoUrl = 'https://github.com/acme/widgets';
      h.vault.projectNotes = [
        {
          path: 'Projecten/Other Name/_Other Name.md',
          projectName: 'Other Name',
          archivedAt: null,
          connections: { github: { tool: 'github', project: repoUrl } },
          connectionErrors: [],
        },
      ];
      h.projectManagement.boards = [
        board('New Board', '2026-10-05T10:00:00Z', boardUrl),
      ];
      h.projectManagement.boardRepositories.set(boardUrl, [repoUrl]);

      const { captured } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual([]);
      expect(h.vault.created).toEqual([]);
    });

    it('adopts the current clock on first sight and captures nothing', async () => {
      const h = setup();
      h.projectManagement.boards = [
        board('Existing Board', '2026-09-01T00:00:00Z'),
      ];

      const { captured } = await h.action.execute({
        syncedAt: '2026-10-06T12:00:00Z',
      });

      expect(captured).toEqual([]);
      expect(h.vault.created).toEqual([]);
      expect(await h.syncState.getProjectCursor('github')).toBe(
        '2026-09-01T00:00:00Z',
      );
    });

    it('leaves a board-born project on its declared github connection through the lifecycle', async () => {
      const h = setup();
      h.syncState.projectCursors.set('github', cursor);
      const boardUrl = 'https://github.com/users/acme/projects/9';
      const repoUrl = 'https://github.com/acme/widgets';
      h.projectManagement.boards = [
        board('New Board', '2026-10-05T10:00:00Z', boardUrl),
      ];
      h.projectManagement.boardRepositories.set(boardUrl, [repoUrl]);
      h.projectManagement.identities.set(boardUrl, identityFor('9'));
      await h.action.execute({ syncedAt: '2026-10-06T12:00:00Z' });
      const homePath = 'Projecten/New Board/_New Board.md';

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

      expect(h.taskManager.createCalls).toEqual([]);
      expect(h.vault.notes.get(homePath)).toBe(GITHUB_HOME);
      expect(
        (await h.syncState.getIdentity('New Board', 'github'))?.repoUrl,
      ).toBe(repoUrl);
    });
  });

  it('is idempotent: a second pass over a captured project captures nothing', async () => {
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

    h.vault.projectNotes = [
      {
        path: 'Projecten/New Project/_New Project.md',
        projectName: 'New Project',
        archivedAt: null,
        connections: { todoist: { tool: 'todoist', project: 'P-new' } },
        connectionErrors: [],
      },
    ];

    const { captured } = await h.action.execute({
      syncedAt: '2026-10-06T12:05:00Z',
    });

    expect(captured).toEqual([]);
    expect(h.vault.created).toEqual([]);
  });

  it('splices a Todoist-captured project to a board once a repo is attached (PRJ-2 + PRJ-1)', async () => {
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
    h.syncState.identities.set('New Project', {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: '',
      projectNodeId: '',
      statusFieldId: '',
      statusOptions: [],
    });
    h.projectManagement.repoBoards = { repoNodeId: 'R_kgDOAAAA', boards: [] };
    await h.ensureBoard.execute({
      projectName: 'New Project',
      connectionSlug: 'github',
    });

    const home = h.vault.notes.get('Projecten/New Project/_New Project.md');
    expect(home).toBe(TODOIST_HOME);
    expect(h.setup.createCalls).toEqual([
      {
        target: 'https://github.com/acme/widgets',
        name: 'widgets',
        statusOptions: ['Unshaped'],
      },
    ]);
    expect(await h.syncState.getIdentity('New Project', 'github')).toEqual({
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_new',
      statusFieldId: 'PVTF_new',
      statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
    });
  });
});

describe('F3/F4 — the capture cursor is a watermark over handled projects', () => {
  it('does not advance the cursor past an unresolvable board, and retries it', async () => {
    const h = setup();
    h.syncState.projectCursors.set('github', cursor);
    const boardUrl = 'https://github.com/users/acme/projects/9';
    h.projectManagement.boards = [
      board('New Board', '2026-10-05T10:00:00Z', boardUrl),
    ];
    h.projectManagement.boardRepositories.set(boardUrl, [
      'https://github.com/acme/widgets',
    ]);

    await h.action.execute({ syncedAt: '2026-10-06T12:00:00Z' });

    expect(h.vault.created).toEqual([]);
    expect(h.syncState.projectCursors.get('github')).toBe(cursor);

    h.projectManagement.identities.set(boardUrl, identityFor('9'));
    const { captured } = await h.action.execute({
      syncedAt: '2026-10-06T12:05:00Z',
    });

    expect(captured).toEqual(['New Board']);
    expect(h.syncState.projectCursors.get('github')).toBe(
      '2026-10-05T10:00:00Z',
    );
  });

  it('does not report a home-note-skipped project as captured', async () => {
    const h = setup();
    h.syncState.projectCursors.set('todoist', cursor);
    h.taskManager.projects = [
      todoistProject({
        id: 'P-new',
        name: 'New Project',
        createdAt: '2026-10-05T10:00:00Z',
      }),
    ];
    h.vault.notes.set('Projecten/New Project/_New Project.md', TODOIST_HOME);

    const { captured } = await h.action.execute({
      syncedAt: '2026-10-06T12:00:00Z',
    });

    expect(captured).toEqual([]);
    expect(h.vault.created).toEqual([]);
    expect(h.syncState.projectCursors.get('todoist')).toBe(cursor);
  });

  it('performs zero cursor writes on a quiet tick', async () => {
    const h = setup();
    h.syncState.projectCursors.set('todoist', '2026-10-05T10:00:00Z');
    h.syncState.projectCursors.set('github', '2026-10-05T10:00:00Z');
    h.taskManager.projects = [
      todoistProject({ createdAt: '2026-10-01T00:00:00Z' }),
    ];
    h.projectManagement.boards = [board('Old Board', '2026-10-01T00:00:00Z')];

    const { captured } = await h.action.execute({
      syncedAt: '2026-10-06T12:00:00Z',
    });

    expect(captured).toEqual([]);
    expect(h.syncState.cursorSets).toEqual([]);
  });
});
