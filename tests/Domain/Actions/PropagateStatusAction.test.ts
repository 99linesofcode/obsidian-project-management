import { describe, expect, it } from 'vitest';
import { PropagateStatusAction } from '../../../src/Domain/Actions/PropagateStatusAction.js';
import { TaskStatus } from '../../../src/Domain/Enums/TaskStatus.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';

// Fakes at the ports: record the state change the action asks for and hold
// the status record in memory, so the action's own behaviour (PATCH state +
// baseline refresh) is what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  updated: TaskData = {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    title: 'Fix the Bug!',
    body: 'The bug happens when the widget is resized.',
    state: 'closed',
    updatedAt: '2026-09-18T12:30:00Z',
    labels: ['type:task'],
  };

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
    return this.updated;
  }
}

class FakeSyncState implements SyncStatePort {
  statuses = new Map<string, Status>();
  setCalls: Status[] = [];

  async get(url: string): Promise<Status | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: Status): Promise<void> {
    this.statuses.set(status.url, status);
    this.setCalls.push(status);
  }
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async getLastPoll(): Promise<string | null> {
    return null;
  }
  async setLastPoll(): Promise<void> {}
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

describe('PropagateStatusAction', () => {
  it('closes the issue for a done note and refreshes the baseline', async () => {
    // Given — a synced note whose status the user flipped to done
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = { ...task, state: 'closed', updatedAt: '2026-09-18T12:30:00Z' };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    const action = new PropagateStatusAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({ url: task.url, status: TaskStatus.Done, notePath });

    // Then — the issue is closed
    expect(projectManagement.stateCalls).toEqual([{ url: task.url, state: 'closed' }]);
    // And the baseline is refreshed from the response, keeping the other fields
    expect(syncState.setCalls).toEqual([
      {
        url: task.url,
        remoteId: task.remoteId,
        notePath,
        lastSyncedBodyHash: hash(task.body),
        lastSyncedRemoteUpdatedAt: '2026-09-18T12:30:00Z',
        lastSyncedStatus: TaskStatus.Done,
        lastSyncedTitle: task.title,
      },
    ]);
  });

  it('reopens the issue for an open note and refreshes the baseline', async () => {
    // Given — a synced note whose status the user flipped back to open
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = { ...task, state: 'open', updatedAt: '2026-09-18T12:30:00Z' };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus({ lastSyncedStatus: TaskStatus.Done }));
    const action = new PropagateStatusAction(projectManagement, syncState);

    // When — the open status is propagated
    await action.execute({ url: task.url, status: TaskStatus.Open, notePath });

    // Then — the issue is reopened
    expect(projectManagement.stateCalls).toEqual([{ url: task.url, state: 'open' }]);
    // And the baseline is refreshed from the response
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.lastSyncedStatus).toBe(TaskStatus.Open);
    expect(syncState.setCalls[0]!.lastSyncedRemoteUpdatedAt).toBe('2026-09-18T12:30:00Z');
  });
});
