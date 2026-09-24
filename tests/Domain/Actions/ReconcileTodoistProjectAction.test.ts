import { describe, expect, it } from 'vitest';
import { ReconcileTodoistProjectAction } from '../../../src/Domain/Actions/ReconcileTodoistProjectAction.js';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../../../src/Domain/Ports/TaskManagerPort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the vault holds note content and records writes, the
// task manager holds a project list and records the lifecycle mutations, and
// the sync state holds the per-project Todoist bookkeeping. The action's
// ensure/rename/archive/freeze decisions are what's under test, and the fakes'
// real mutation is what makes idempotency observable.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  writes: Array<{ path: string; content: string }> = [];

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
  async moveFolder(): Promise<void> {}
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
    // the action's fetch-by-id path is exercised.
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

class FakeSyncState implements SyncStatePort {
  todoistStates = new Map<string, TodoistProjectStateData>();
  todoistSets: Array<{ projectName: string; state: TodoistProjectStateData }> =
    [];

  async get(): Promise<Status | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return [];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<null> {
    return null;
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
}

const syncedAt = '2026-09-24T12:00:00Z';
const notePath = 'Projecten/Acme Widgets/_home.md';

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

function setup() {
  const vault = new FakeVault();
  const taskManager = new FakeTaskManager();
  const syncState = new FakeSyncState();
  const action = new ReconcileTodoistProjectAction(
    taskManager,
    vault,
    syncState,
  );
  return { action, vault, taskManager, syncState };
}

describe('ReconcileTodoistProjectAction', () => {
  it('creates and stamps the project on first sight', async () => {
    // Given — a project note with no Todoist anchor and no matching project
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(notePath, note());

    // When — the project is mirrored
    const result = await action.execute({
      projectName: 'Acme Widgets',
      notePath,
      locationArchived: false,
      syncedAt,
    });

    // Then — a project is created and its id is stamped into the note
    expect(taskManager.createCalls).toEqual(['Acme Widgets']);
    expect(vault.writes).toEqual([{ path: notePath, content: note('P-new') }]);
    // And the active project id is returned, so the task projection runs
    expect(result).toBe('P-new');
    // And the bookkeeping record is created
    expect(syncState.todoistSets).toEqual([
      {
        projectName: 'Acme Widgets',
        state: { sections: {}, lastCompletedPoll: syncedAt },
      },
    ]);
  });

  it('resolves by name before creating, so no duplicate is made', async () => {
    // Given — a project note with no anchor and a Todoist project already
    // carrying the note's name
    const { action, vault, taskManager } = setup();
    vault.notes.set(notePath, note());
    taskManager.projects.push(project({ id: 'P-existing' }));

    // When — the project is mirrored
    await action.execute({
      projectName: 'Acme Widgets',
      notePath,
      locationArchived: false,
      syncedAt,
    });

    // Then — the existing project is adopted and stamped, nothing is created
    expect(taskManager.createCalls).toEqual([]);
    expect(vault.writes).toEqual([
      { path: notePath, content: note('P-existing') },
    ]);
  });

  it('renames the project when the note name drifts', async () => {
    // Given — an anchored project whose Todoist name is stale
    const { action, vault, taskManager } = setup();
    vault.notes.set(notePath, note('P1'));
    taskManager.projects.push(project({ name: 'Old Name' }));

    // When — the project is mirrored
    await action.execute({
      projectName: 'Acme Widgets',
      notePath,
      locationArchived: false,
      syncedAt,
    });

    // Then — the Todoist project follows the note's name
    expect(taskManager.updateCalls).toEqual([
      { id: 'P1', name: 'Acme Widgets' },
    ]);
  });

  it('archives the project when the note moves to Archief/', async () => {
    // Given — an active anchored project whose note is under Archief/
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(notePath, note('P1'));
    taskManager.projects.push(project());

    // When — the project is mirrored
    await action.execute({
      projectName: 'Acme Widgets',
      notePath,
      locationArchived: true,
      syncedAt,
    });

    // Then — the Todoist project is archived and no bookkeeping is written
    expect(taskManager.archiveCalls).toEqual([{ id: 'P1', archived: true }]);
    expect(syncState.todoistSets).toEqual([]);
  });

  it('unarchives the project when the note moves back to Projecten/', async () => {
    // Given — an archived anchored project whose note is active again
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(notePath, note('P1'));
    taskManager.projects.push(project({ isArchived: true }));

    // When — the project is mirrored
    await action.execute({
      projectName: 'Acme Widgets',
      notePath,
      locationArchived: false,
      syncedAt,
    });

    // Then — the Todoist project is unarchived and bookkeeping resumes
    expect(taskManager.archiveCalls).toEqual([{ id: 'P1', archived: false }]);
    expect(syncState.todoistSets).toEqual([
      {
        projectName: 'Acme Widgets',
        state: { sections: {}, lastCompletedPoll: syncedAt },
      },
    ]);
  });

  it('freezes an archived project: no rename, no archive, no bookkeeping', async () => {
    // Given — an archived anchored project whose note is under Archief/ and
    // whose Todoist name has drifted
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(notePath, note('P1'));
    taskManager.projects.push(project({ name: 'Old Name', isArchived: true }));

    // When — the project is mirrored
    const result = await action.execute({
      projectName: 'Acme Widgets',
      notePath,
      locationArchived: true,
      syncedAt,
    });

    // Then — nothing is written to Todoist and no bookkeeping is recorded
    expect(taskManager.updateCalls).toEqual([]);
    expect(taskManager.archiveCalls).toEqual([]);
    expect(syncState.todoistSets).toEqual([]);
    // And the freeze returns null, so the task projection is gated off
    expect(result).toBeNull();
  });

  it('re-stamps the anchor when it points at a project that no longer exists', async () => {
    // Given — a note anchored to a deleted project, and a name match available
    const { action, vault, taskManager } = setup();
    vault.notes.set(notePath, note('P-gone'));
    taskManager.projects.push(project({ id: 'P-existing' }));

    // When — the project is mirrored
    await action.execute({
      projectName: 'Acme Widgets',
      notePath,
      locationArchived: false,
      syncedAt,
    });

    // Then — the name match is adopted and the stale anchor is replaced
    expect(taskManager.createCalls).toEqual([]);
    expect(vault.writes).toEqual([
      { path: notePath, content: note('P-existing') },
    ]);
  });

  it('is idempotent: a settled project writes nothing', async () => {
    // Given — an anchored, correctly named, active project with bookkeeping
    const { action, vault, taskManager, syncState } = setup();
    vault.notes.set(notePath, note('P1'));
    taskManager.projects.push(project());
    syncState.todoistStates.set('Acme Widgets', {
      sections: {},
      lastCompletedPoll: syncedAt,
    });

    // When — the settled project is mirrored
    await action.execute({
      projectName: 'Acme Widgets',
      notePath,
      locationArchived: false,
      syncedAt,
    });

    // Then — no create, no rename, no archive, no stamp, no bookkeeping
    expect(taskManager.createCalls).toEqual([]);
    expect(taskManager.updateCalls).toEqual([]);
    expect(taskManager.archiveCalls).toEqual([]);
    expect(vault.writes).toEqual([]);
    expect(syncState.todoistSets).toEqual([]);
  });

  it('does nothing when the project note is gone', async () => {
    // Given — a note path that no longer resolves
    const { action, taskManager, syncState } = setup();

    // When — the project is mirrored
    await action.execute({
      projectName: 'Acme Widgets',
      notePath,
      locationArchived: false,
      syncedAt,
    });

    // Then — no Todoist call is made
    expect(taskManager.createCalls).toEqual([]);
    expect(syncState.todoistSets).toEqual([]);
  });
});
