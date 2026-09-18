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
import { ApplyRemoteChangeAction } from '../../../src/Domain/Actions/ApplyRemoteChangeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports so the scheduler's per-project invocation is observable
// through the real composed action, without touching Obsidian or GitHub.
class FakeVault implements VaultPort {
  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
}

class FakeSyncState implements SyncStatePort {
  lastPollCalls: Array<{ projectName: string; iso: string }> = [];

  async get(): Promise<Status | null> {
    return null;
  }
  async set(): Promise<void> {}
  async getLastPoll(): Promise<string | null> {
    return null;
  }
  async setLastPoll(projectName: string, iso: string): Promise<void> {
    this.lastPollCalls.push({ projectName, iso });
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
}

describe('SyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Obsidian runs in a browser where window is the global; the scheduler
    // uses window.setInterval, so point window at the faked global timers.
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
    const applyRemoteChange = new ApplyRemoteChangeAction(vault, syncState, createTaskNote);
    const syncProject = new SyncProjectAction(
      projectManagement,
      syncState,
      applyRemoteChange,
      createTaskNote,
    );
    const scheduler = new SyncScheduler(syncProject, ['Acme Widgets', 'Other'], 60_000);
    scheduler.load();

    // When — one interval elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the action ran once per project, each with a fresh cursor
    expect(projectManagement.sinceCalls).toHaveLength(2);
    expect(syncState.lastPollCalls).toHaveLength(2);
    expect(syncState.lastPollCalls[0]!.projectName).toBe('Acme Widgets');
    expect(syncState.lastPollCalls[1]!.projectName).toBe('Other');
  });
});
