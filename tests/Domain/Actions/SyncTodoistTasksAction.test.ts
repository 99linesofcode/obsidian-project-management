import { describe, expect, it } from 'vitest';
import { SyncTodoistTasksAction } from '../../../src/Domain/Actions/SyncTodoistTasksAction.js';
import type {
  ApplyTaskToTodoistAction,
  ApplyTaskToTodoistInput,
  ApplyToDoToTodoistInput,
} from '../../../src/Domain/Actions/ApplyTaskToTodoistAction.js';
import type { ApplyTodoistCompletionAction } from '../../../src/Domain/Actions/ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from '../../../src/Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from '../../../src/Domain/Actions/CaptureTodoistCreationsAction.js';
import type { EnsureTodoistSectionsAction } from '../../../src/Domain/Actions/EnsureTodoistSectionsAction.js';
import type { PropagateTodoistDeletionsAction } from '../../../src/Domain/Actions/PropagateTodoistDeletionsAction.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  folders = new Map<string, string[]>();

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folders.get(folder) ?? [];
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
    repoNodeId: 'R',
    projectNodeId: 'PVT',
    statusFieldId: 'F',
    statusOptions: [
      { id: 'O1', name: 'Unshaped' },
      { id: 'O2', name: 'Building' },
      { id: 'O3', name: 'Shipped' },
    ],
  };
  statuses = new Map<string, TaskData>();
  todoistStates = new Map<string, TaskData>();
  projectState: TodoistProjectStateData | null = null;
  projectStateSets: TodoistProjectStateData[] = [];

  async get(url: string): Promise<TaskData | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<TaskData | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<TaskData[]> {
    return [...this.statuses.values()];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }
  async setLastProjectUpdate(): Promise<void> {}
  async getArchiveBaseline(): Promise<null> {
    return null;
  }
  async setArchiveBaseline(): Promise<void> {}
  async getWatchState(): Promise<{ etag: null; cursor: null }> {
    return { etag: null, cursor: null };
  }
  async setWatchState(): Promise<void> {}
  async getTodoistProjectState(): Promise<TodoistProjectStateData | null> {
    return this.projectState;
  }
  async setTodoistProjectState(
    _projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    this.projectStateSets.push(state);
    this.projectState = state;
  }
  async getTodoistState(notePath: string): Promise<TaskData | null> {
    return this.todoistStates.get(notePath) ?? null;
  }
  async setTodoistState(): Promise<void> {}
  async removeTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<TaskData[]> {
    return [...this.todoistStates.values()];
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  issues: GithubTaskData[] = [];

  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return this.issues;
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchProjectDetail(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<Map<string, ProjectStateData>> {
    return new Map();
  }
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
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
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setBoardStatus(): Promise<void> {}
  async addBoardItem(): Promise<void> {}
  async addLabel(): Promise<void> {}
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

class FakeTaskManager implements TaskManagerPort {
  active: TodoistTaskData[] = [];

  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
    return this.active;
  }
  async fetchProjects(): Promise<TodoistProjectData[]> {
    return [];
  }
  async fetchProject(): Promise<null> {
    return null;
  }
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectArchived(): Promise<never> {
    throw new Error('not used in this test');
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
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async createTask(): Promise<never> {
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

class FakeWriter {
  taskCalls: ApplyTaskToTodoistInput[] = [];
  todoCalls: ApplyToDoToTodoistInput[] = [];
  nextId = 'T-new';

  async executeTask(input: ApplyTaskToTodoistInput): Promise<string> {
    this.taskCalls.push(input);
    return this.nextId;
  }
  async executeToDo(input: ApplyToDoToTodoistInput): Promise<string> {
    this.todoCalls.push(input);
    return this.nextId;
  }
}

function recorder(events: string[], name: string) {
  return {
    execute: async () => {
      events.push(name);
    },
  };
}

function issue(overrides: Partial<GithubTaskData> = {}): GithubTaskData {
  return {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: 'I',
    title: 'Fix the bug',
    body: '',
    state: 'open',
    updatedAt: '2026-09-18T11:00:00Z',
    labels: ['type: task'],
    ...overrides,
  };
}

function status(notePath: string, url: string): TaskData {
  return taskRecord({
    url,
    remoteId: 42,
    notePath,
    body: 'h',
    updatedAt: '2026-09-18T11:00:00Z',
    status: 'Building',
    title: 'Fix the bug',
  });
}

function taskNote(statusName: string, body = '', todoistId?: string): string {
  const lines = [
    '---',
    `url: https://github.com/acme/widgets/issues/42`,
    `status: ${statusName}`,
    'affiliation: ["[[Acme Widgets]]"]',
  ];
  if (todoistId !== undefined) {
    lines.push(`todoist: ${todoistId}`);
  }
  lines.push('---', body);
  return lines.join('\n');
}

function harness() {
  const events: string[] = [];
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const projectManagement = new FakeProjectManagement();
  const taskManager = new FakeTaskManager();
  const writer = new FakeWriter();
  const action = new SyncTodoistTasksAction(
    taskManager,
    projectManagement,
    vault,
    syncState,
    {
      execute: async () => ({ Unshaped: 'S1', Building: 'S2', Shipped: 'S3' }),
    } as unknown as EnsureTodoistSectionsAction,
    writer as unknown as ApplyTaskToTodoistAction,
    recorder(
      events,
      'applyRemoteChanges',
    ) as unknown as ApplyTodoistRemoteChangesAction,
    recorder(
      events,
      'captureCreations',
    ) as unknown as CaptureTodoistCreationsAction,
    recorder(
      events,
      'applyCompletion',
    ) as unknown as ApplyTodoistCompletionAction,
    recorder(
      events,
      'propagateDeletions',
    ) as unknown as PropagateTodoistDeletionsAction,
    'Shipped',
  );
  return {
    action,
    events,
    vault,
    syncState,
    projectManagement,
    taskManager,
    writer,
  };
}

const input = {
  projectName: 'Acme Widgets',
  projectId: 'P1',
  syncedAt: '2026-09-18T12:00:00Z',
};

const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

describe('SyncTodoistTasksAction', () => {
  it('absorbs remote changes and captures before projecting, deletions last', async () => {
    // Given — a tracked issue with a task note
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the retained steps run around the canonical projection
    expect(h.events).toEqual([
      'applyRemoteChanges',
      'captureCreations',
      'applyCompletion',
      'propagateDeletions',
    ]);
    expect(h.writer.taskCalls).toHaveLength(1);
    expect(h.writer.taskCalls[0]!.task.title).toBe('Fix the bug');
    expect(h.writer.taskCalls[0]!.task.status).toBe('Building');
    expect(h.writer.taskCalls[0]!.sectionId).toBe('S2');
  });

  it('records the lane map when the sections moved', async () => {
    // Given — a project with no stored lane map
    const h = harness();
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(taskPath, taskNote('Building'));
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the lane map is persisted
    expect(h.syncState.projectStateSets).toEqual([
      {
        sections: { Unshaped: 'S1', Building: 'S2', Shipped: 'S3' },
        lastCompletedPoll: input.syncedAt,
      },
    ]);
  });

  it('skips the task projection for a project with no GitHub attach', async () => {
    // Given — a project without a repo url
    const h = harness();
    h.syncState.identity = null;

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — no task is projected
    expect(h.writer.taskCalls).toEqual([]);
  });

  it('nests a child under its slice twin', async () => {
    // Given — a slice and a child affiliated to it
    const h = harness();
    const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
    const childPath = 'Projecten/Acme Widgets/taken/42-the-child.md';
    const sliceUrl = 'https://github.com/acme/widgets/issues/40';
    const childUrl = 'https://github.com/acme/widgets/issues/42';
    h.projectManagement.issues = [
      issue({
        url: sliceUrl,
        remoteId: 40,
        title: 'The slice',
        labels: ['type: slice'],
      }),
      issue({ url: childUrl, remoteId: 42, title: 'The child' }),
    ];
    h.vault.notes.set(
      slicePath,
      `---\nurl: ${sliceUrl}\nstatus: Building\naffiliation: ["[[Acme Widgets]]"]\n---\n`,
    );
    h.vault.notes.set(
      childPath,
      `---\nurl: ${childUrl}\nstatus: Building\naffiliation: ["[[Acme Widgets]]", "[[40-the-slice]]"]\n---\n`,
    );
    h.syncState.statuses.set(sliceUrl, status(slicePath, sliceUrl));
    h.syncState.statuses.set(childUrl, status(childPath, childUrl));

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the child is placed under the slice's new twin id
    const childCall = h.writer.taskCalls.find(
      (call) => call.task.title === 'The child',
    );
    expect(childCall?.parentId).toBe('T-new');
  });

  it('projects a to-do linked from a task checklist', async () => {
    // Given — a task with a twin anchor and a linked to-do note
    const h = harness();
    const todoPath = 'Projecten/Acme Widgets/todos/step-one.md';
    h.projectManagement.issues = [issue()];
    h.vault.notes.set(
      taskPath,
      taskNote('Building', `- [ ] [[${todoPath}|Step one]]`, 'T-task'),
    );
    h.vault.notes.set(
      todoPath,
      '---\nstatus: open\naffiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]\n---\n',
    );
    h.syncState.statuses.set(issue().url, status(taskPath, issue().url));
    h.vault.folders.set('Projecten/Acme Widgets/taken', [taskPath]);

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the to-do is projected under the task's twin
    expect(h.writer.todoCalls).toHaveLength(1);
    expect(h.writer.todoCalls[0]!.todo.title).toBe('Step one');
    expect(h.writer.todoCalls[0]!.parentId).toBe('T-task');
  });

  it('swallows a step failure so the GitHub half is never affected', async () => {
    // Given — a remote-absorption step that throws
    const events: string[] = [];
    const action = new SyncTodoistTasksAction(
      new FakeTaskManager(),
      new FakeProjectManagement(),
      new FakeVault(),
      new FakeSyncState(),
      { execute: async () => ({}) } as unknown as EnsureTodoistSectionsAction,
      new FakeWriter() as unknown as ApplyTaskToTodoistAction,
      {
        execute: async () => {
          throw new Error('todoist failed');
        },
      } as unknown as ApplyTodoistRemoteChangesAction,
      recorder(
        events,
        'captureCreations',
      ) as unknown as CaptureTodoistCreationsAction,
      recorder(
        events,
        'applyCompletion',
      ) as unknown as ApplyTodoistCompletionAction,
      recorder(
        events,
        'propagateDeletions',
      ) as unknown as PropagateTodoistDeletionsAction,
      'Shipped',
    );

    // When — the Todoist half runs
    await expect(action.execute(input)).resolves.toBeUndefined();

    // Then — no later step ran and the failure did not propagate
    expect(events).toEqual([]);
  });
});
