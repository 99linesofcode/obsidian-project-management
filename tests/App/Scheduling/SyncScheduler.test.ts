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
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports so the scheduler's per-project invocation is observable
// through the real composed action, without touching Obsidian or GitHub.
class FakeVault implements VaultPort {
  noteChangedCb: ((path: string) => void) | null = null;
  noteDeletedCb: ((path: string) => void) | null = null;

  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(cb: (path: string) => void): void {
    this.noteChangedCb = cb;
  }
  onNoteDeleted(cb: (path: string) => void): void {
    this.noteDeletedCb = cb;
  }
  fireNoteChanged(path: string): void {
    this.noteChangedCb?.(path);
  }
  fireNoteDeleted(path: string): void {
    this.noteDeletedCb?.(path);
  }
}

class FakeSyncState implements SyncStatePort {
  lastPollCalls: Array<{ projectName: string; iso: string }> = [];

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
  async getIdentity(): Promise<null> {
    return null;
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
  async fetchChangedTasks(since: string): Promise<TaskData[]> {
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
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setBoardStatus(): Promise<void> {
    throw new Error('not used in this test');
  }
  async addBoardItem(): Promise<void> {
    throw new Error('not used in this test');
  }
}

// A fake reconcile action that records its invocations and can be made slow,
// so the scheduler's debounce and per-project serialisation are observable.
class FakeReconcile {
  calls: Array<{ notePath: string; projectName: string; syncedAt: string }> = [];
  active = 0;
  maxActive = 0;
  private resolvers: Array<() => void> = [];

  async execute(input: { notePath: string; projectName: string; syncedAt: string }): Promise<void> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.calls.push(input);
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

const fakeSyncProject = { execute: vi.fn(async () => {}) } as unknown as SyncProjectAction;

// A fake delete handler that records its invocations, so the scheduler's
// wiring of the delete path is observable.
class FakeHandleDeleted {
  calls: Array<{ notePath: string; projectName: string }> = [];

  async execute(input: { notePath: string; projectName: string }): Promise<void> {
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
    const projectManagement = new FakeProjectManagement();
    const createTaskNote = new CreateTaskNoteAction(vault, syncState);
    const applyRemoteChange = new ApplyRemoteChangeAction(
      vault,
      syncState,
      createTaskNote,
      new BoardStatusAction(syncState, projectManagement, 'Done'),
    );
    const applyBoardChange = new ApplyBoardChangeAction(syncState, projectManagement, vault, 'Done');
    const syncProject = new SyncProjectAction(
      projectManagement,
      syncState,
      applyRemoteChange,
      createTaskNote,
      applyBoardChange,
    );
    const reconcile = new FakeReconcile();
    const handleDeleted = new FakeHandleDeleted();
    const scheduler = new SyncScheduler(
      syncProject,
      ['Acme Widgets', 'Other'],
      60_000,
      vault,
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
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
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      0,
    );
    scheduler.load();

    // When — a task note under Projecten changes
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — the reconcile runs for the derived project with the note path
    expect(reconcile.calls).toHaveLength(1);
    expect(reconcile.calls[0]!.projectName).toBe('Acme Widgets');
    expect(reconcile.calls[0]!.notePath).toBe('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
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
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
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
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
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
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
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
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
      2000,
    );
    scheduler.load();

    // When — a task note under Projecten is deleted twice within the window
    vault.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    vault.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(2000);

    // Then — the delete handler runs once with the note path
    expect(handleDeleted.calls).toHaveLength(1);
    expect(handleDeleted.calls[0]!.notePath).toBe('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
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
      reconcile as unknown as ReconcileTaskAction,
      handleDeleted as unknown as HandleDeletedNoteAction,
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
