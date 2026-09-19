import { describe, expect, it } from 'vitest';
import { HandleDeletedNoteAction } from '../../../src/Domain/Actions/HandleDeletedNoteAction.js';
import { TaskStatus } from '../../../src/Domain/Enums/TaskStatus.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';

// Fakes at the ports: record the state change and the record removal the
// action asks for, so the action's own behaviour (find → close → remove) is
// what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchChangedTasks(): Promise<TaskData[]> {
    return [];
  }
  async fetchTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }
  async setTaskState(url: string, state: 'open' | 'closed'): Promise<TaskData> {
    this.stateCalls.push({ url, state });
    return {
      url,
      remoteId: 42,
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state,
      updatedAt: '2026-09-18T12:30:00Z',
      labels: ['type:task'],
    };
  }
}

class FakeSyncState implements SyncStatePort {
  statuses = new Map<string, Status>();
  removed: string[] = [];

  async get(url: string): Promise<Status | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: Status): Promise<void> {
    this.statuses.set(status.url, status);
  }
  async findByNotePath(notePath: string): Promise<Status | null> {
    for (const status of this.statuses.values()) {
      if (status.notePath === notePath) {
        return status;
      }
    }
    return null;
  }
  async remove(url: string): Promise<void> {
    this.statuses.delete(url);
    this.removed.push(url);
  }
  async getLastPoll(): Promise<string | null> {
    return null;
  }
  async setLastPoll(): Promise<void> {}
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<null> {
    return null;
  }
}

const task: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: ['type:task'],
};

const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    url: task.url,
    remoteId: task.remoteId,
    notePath,
    lastSyncedBodyHash: hash(task.body),
    lastSyncedRemoteUpdatedAt: task.updatedAt,
    lastSyncedStatus: TaskStatus.Open,
    lastSyncedTitle: task.title,
    ...overrides,
  };
}

describe('HandleDeletedNoteAction', () => {
  it('closes the issue and removes the record for a tracked note', async () => {
    // Given — a tracked note (a status record exists for its path)
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    const action = new HandleDeletedNoteAction(syncState, projectManagement);

    // When — the note is deleted
    await action.execute({ notePath });

    // Then — the issue is closed and the status record is removed
    expect(projectManagement.stateCalls).toEqual([{ url: task.url, state: 'closed' }]);
    expect(syncState.removed).toEqual([task.url]);
    expect(syncState.statuses.has(task.url)).toBe(false);
  });

  it('does nothing for an untracked note', async () => {
    // Given — no status record for the deleted path (an untracked file)
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    const action = new HandleDeletedNoteAction(syncState, projectManagement);

    // When — the note is deleted
    await action.execute({ notePath: 'Projecten/Acme Widgets/taken/99-untracked.md' });

    // Then — nothing is closed or removed
    expect(projectManagement.stateCalls).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });
});
