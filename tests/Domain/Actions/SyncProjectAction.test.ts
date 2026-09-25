import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../../src/Domain/Actions/SyncProjectAction.js';
import type { DetectNoteRenamesAction } from '../../../src/Domain/Actions/DetectNoteRenamesAction.js';
import type { HandleDeletedNoteAction } from '../../../src/Domain/Actions/HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from '../../../src/Domain/Actions/MirrorTodoStatusAction.js';
import type { ProbeProjectsAction } from '../../../src/Domain/Actions/ProbeProjectsAction.js';
import type { ReconcileArchiveStateAction } from '../../../src/Domain/Actions/ReconcileArchiveStateAction.js';
import type { ReconcileTaskAction } from '../../../src/Domain/Actions/ReconcileTaskAction.js';
import type { SyncChecklistAction } from '../../../src/Domain/Actions/SyncChecklistAction.js';
import type { SyncGithubTasksAction } from '../../../src/Domain/Actions/SyncGithubTasksAction.js';
import type { SyncTodoistTasksAction } from '../../../src/Domain/Actions/SyncTodoistTasksAction.js';
import type { WatchArchivedProjectAction } from '../../../src/Domain/Actions/WatchArchivedProjectAction.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { TodoistStateData } from '../../../src/Domain/DataTransferObjects/TodoistStateData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports and at every composed step, recording into one shared
// events array so the chain's step order and its error isolation are what's
// under test.
class FakeVault implements VaultPort {
  projectNotes: ProjectNoteData[] = [];
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
    return this.projectNotes;
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeSyncState implements SyncStatePort {
  statuses: Status[] = [];
  todoistStates: TodoistStateData[] = [];
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
  async list(): Promise<Status[]> {
    return this.statuses;
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<null> {
    return null;
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
  async setArchiveBaseline(): Promise<void> {}
  async getWatchState(): Promise<{ etag: null; cursor: null }> {
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
  async removeTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<TodoistStateData[]> {
    return this.todoistStates;
  }
}

class FakeProbe {
  fail = false;
  states = new Map<string, ProjectStateData>();

  async execute(): Promise<Map<string, ProjectStateData>> {
    if (this.fail) {
      throw new Error('probe failed');
    }
    return this.states;
  }
}

class FakeSweep {
  fail = false;
  calls: Array<{
    projectName: string;
    syncedAt: string;
    includeBoard: boolean;
  }> = [];

  constructor(private readonly events: string[]) {}

  async execute(input: {
    projectName: string;
    syncedAt: string;
    includeBoard: boolean;
  }): Promise<void> {
    this.calls.push(input);
    this.events.push('sweep');
    if (this.fail) {
      throw new Error('sweep failed');
    }
  }
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

function status(notePath: string): Status {
  return {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    notePath,
    lastSyncedBodyHash: 'abc',
    lastSyncedRemoteUpdatedAt: '2026-09-18T11:00:00Z',
    lastSyncedStatus: 'Building',
    lastSyncedTitle: 'Fix the bug',
  };
}

interface HarnessOptions {
  projectNotes?: ProjectNoteData[];
  state?: ProjectStateData | undefined;
  statuses?: Status[];
  taken?: string[];
  todos?: string[];
}

function harness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const vault = new FakeVault();
  vault.projectNotes = options.projectNotes ?? [
    projectNote('Acme Widgets', false),
  ];
  vault.folders.set('Projecten/Acme Widgets/taken', options.taken ?? []);
  vault.folders.set('Projecten/Acme Widgets/todos', options.todos ?? []);
  const syncState = new FakeSyncState();
  syncState.statuses = options.statuses ?? [];

  const probe = new FakeProbe();
  if (options.state !== undefined) {
    probe.states.set('Acme Widgets', options.state);
  }

  const reconcileArchive = {
    execute: async () => {
      events.push('reconcileArchive');
    },
  } as unknown as ReconcileArchiveStateAction;
  const watch = {
    execute: async () => {
      events.push('watch');
    },
  } as unknown as WatchArchivedProjectAction;
  const renames = {
    execute: async () => {
      events.push('renames');
    },
  } as unknown as DetectNoteRenamesAction;
  const sweep = new FakeSweep(events);
  const checklist = {
    execute: async (input: { notePath: string }) => {
      events.push(`checklist:${input.notePath}`);
    },
  } as unknown as SyncChecklistAction;
  const reconcileTask = {
    execute: async (input: { notePath: string }) => {
      events.push(`reconcile:${input.notePath}`);
    },
  } as unknown as ReconcileTaskAction;
  const mirror = {
    execute: async (input: { todoPath: string }) => {
      events.push(`mirror:${input.todoPath}`);
    },
  } as unknown as MirrorTodoStatusAction;
  const todoist = {
    execute: async () => {
      events.push('todoist');
    },
  } as unknown as SyncTodoistTasksAction;
  const handleDeleted = {
    execute: async (input: { notePath: string }) => {
      events.push(`delete:${input.notePath}`);
    },
  } as unknown as HandleDeletedNoteAction;

  const action = new SyncProjectAction(
    vault,
    syncState,
    probe as unknown as ProbeProjectsAction,
    reconcileArchive,
    watch,
    renames,
    sweep as unknown as SyncGithubTasksAction,
    checklist,
    reconcileTask,
    mirror,
    todoist,
    handleDeleted,
  );

  return { action, events, vault, syncState, probe, sweep };
}

const openState: ProjectStateData = {
  projectId: 'PVT_123',
  updatedAt: '2026-09-18T10:00:00Z',
  closed: false,
};

describe('SyncProjectAction', () => {
  it('runs the steps in order: lifecycle, renames, sweep, per-note, Todoist', async () => {
    // Given — an active project with one task note and one to-do note
    const h = harness({
      state: openState,
      taken: ['Projecten/Acme Widgets/taken/42-fix-the-bug.md'],
      todos: ['Projecten/Acme Widgets/todos/fix-the-bug.md'],
    });

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the steps run in the chain's order, the per-note loop after the
    // sweep, the Todoist half last
    expect(h.events).toEqual([
      'reconcileArchive',
      'renames',
      'sweep',
      'checklist:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'reconcile:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'mirror:Projecten/Acme Widgets/todos/fix-the-bug.md',
      'todoist',
    ]);
  });

  it('no-ops a stale work item whose pm-note is gone', async () => {
    // Given — a work item for a project with no pm-note
    const h = harness({ projectNotes: [] });

    // When — the stale item is synced
    await h.action.execute('Acme Widgets');

    // Then — no step runs: project-level deletion is never propagated
    expect(h.events).toEqual([]);
  });

  it('runs the Todoist half even when the GitHub sweep fails', async () => {
    // Given — an active project whose sweep throws
    const h = harness({ state: openState });
    h.sweep.fail = true;

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the Todoist half still ran, and the cursor did not advance
    expect(h.events).toContain('todoist');
    expect(h.syncState.lastUpdateSets).toEqual([]);
  });

  it('runs the Todoist half even when the probe fails', async () => {
    // Given — a project whose probe throws
    const h = harness({ state: openState });
    h.probe.fail = true;

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the GitHub side is skipped but the Todoist half still runs
    expect(h.events).toEqual(['renames', 'todoist']);
  });

  it('advances the stored update only after a successful sweep', async () => {
    // Given — an active project whose probe reports a newer updatedAt
    const h = harness({ state: openState });

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the probe's updatedAt is persisted
    expect(h.syncState.lastUpdateSets).toEqual([
      { projectName: 'Acme Widgets', iso: '2026-09-18T10:00:00Z' },
    ]);
  });

  it('watches an archived project and skips the sweep', async () => {
    // Given — an archived project whose board is closed
    const h = harness({
      projectNotes: [projectNote('Acme Widgets', true)],
      state: { ...openState, closed: true },
    });

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the lifecycle reconciles and watches, the sweep is skipped, the
    // Todoist half still mirrors
    expect(h.events).toEqual([
      'reconcileArchive',
      'watch',
      'renames',
      'todoist',
    ]);
  });

  it('skips the sweep for a closed board but still mirrors Todoist', async () => {
    // Given — an active project whose board is closed
    const h = harness({ state: { ...openState, closed: true } });

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the lifecycle reconciles, the sweep is skipped
    expect(h.events).toEqual(['reconcileArchive', 'renames', 'todoist']);
  });

  it('skips the GitHub side when the project has no probed state', async () => {
    // Given — a project with no GitHub attach (the probe returns no state)
    const h = harness({ state: undefined });

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — no lifecycle, no sweep; the Todoist half still runs
    expect(h.events).toEqual(['renames', 'todoist']);
  });

  it('runs the deletion sweep last, after the Todoist half', async () => {
    // Given — a status record whose note no longer exists
    const h = harness({
      state: openState,
      statuses: [status('Projecten/Acme Widgets/taken/42-gone.md')],
    });

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the deletion runs after the Todoist half
    expect(h.events).toEqual([
      'reconcileArchive',
      'renames',
      'sweep',
      'todoist',
      'delete:Projecten/Acme Widgets/taken/42-gone.md',
    ]);
  });

  it('leaves a status record whose note still exists alone', async () => {
    // Given — a status record whose note is present
    const h = harness({
      state: openState,
      statuses: [status('Projecten/Acme Widgets/taken/42-fix-the-bug.md')],
    });
    h.vault.notes.set(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'content',
    );

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — no deletion runs
    expect(h.events).not.toContain(
      'delete:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );
  });

  it('does not sweep a deletion record under Archief', async () => {
    // Given — an archived project's status record whose note is gone
    const h = harness({
      state: openState,
      statuses: [status('Archief/Acme Widgets/taken/42-gone.md')],
    });

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the frozen project is never swept
    expect(h.events).not.toContain(
      'delete:Archief/Acme Widgets/taken/42-gone.md',
    );
  });

  it('closes the board gate when the stored update matches the probe', async () => {
    // Given — a stored update equal to the probe's updatedAt
    const h = harness({ state: openState });
    h.syncState.lastUpdates.set('Acme Widgets', openState.updatedAt);

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the sweep is told to skip the board fetch
    expect(h.sweep.calls[0]!.includeBoard).toBe(false);
  });

  it('opens the board gate when the probe updatedAt moved', async () => {
    // Given — a stored update older than the probe's updatedAt
    const h = harness({ state: openState });
    h.syncState.lastUpdates.set('Acme Widgets', '2026-09-18T09:00:00Z');

    // When — the project is synced
    await h.action.execute('Acme Widgets');

    // Then — the sweep is told to fetch the board
    expect(h.sweep.calls[0]!.includeBoard).toBe(true);
  });
});
