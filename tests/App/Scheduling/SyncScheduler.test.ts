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
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports so the scheduler's per-project invocation is observable
// through the real composed action, without touching Obsidian or GitHub.
class FakeVault implements VaultPort {
  noteChangedCb: ((path: string) => void) | null = null;
  noteDeletedCb: ((path: string) => void) | null = null;
  noteRenamedCb: ((oldPath: string, newPath: string) => void) | null = null;

  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
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
  lastPollCalls: Array<{ projectName: string; iso: string }> = [];
  identity: ProjectIdentityData | null = null;

  async get(): Promise<Status | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async getLastPoll(): Promise<string | null> {
    return null;
  }
  async setLastPoll(projectName: string, iso: string): Promise<void> {
    this.lastPollCalls.push({ projectName, iso });
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
  async list(): Promise<Status[]> {
    return [];
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  sinceCalls: string[] = [];

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchChangedTasks(
    _repoUrl: string,
    since: string,
  ): Promise<TaskData[]> {
    this.sinceCalls.push(since);
    return [];
  }
  async fetchTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async setTaskState(): Promise<TaskData> {
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
    const scheduler = new SyncScheduler(
      syncProject,
      ['Acme Widgets', 'Other'],
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

    // Then — the action ran once per project, each with a fresh cursor
    expect(projectManagement.sinceCalls).toHaveLength(2);
    expect(syncState.lastPollCalls).toHaveLength(2);
    expect(syncState.lastPollCalls[0]!.projectName).toBe('Acme Widgets');
    expect(syncState.lastPollCalls[1]!.projectName).toBe('Other');
  });

  it('derives the project name from a note change and reconciles it', async () => {
    // Given — a scheduler subscribed to vault note changes
    const vault = new FakeVault();
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      fakeSyncProject,
      [],
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
      [],
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
      [],
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
      [],
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
    expect(relink.calls[0]!.oldPath).toBe(
      'Projecten/Acme Widgets/todos/fi.md',
    );
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
      [],
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
      [],
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
      [],
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
      [],
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
      [],
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
      [],
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
      [],
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
      [],
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
});
