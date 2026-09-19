import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../../src/Domain/Actions/SyncProjectAction.js';
import { ApplyRemoteChangeAction } from '../../../src/Domain/Actions/ApplyRemoteChangeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: hold notes and status records in memory and record the
// operations the composed actions perform, so the orchestration (fetch →
// apply/create → advance cursor) is what's under test.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  written: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }

  async renameNote(): Promise<void> {
    throw new Error('not used in this test');
  }

  onNoteChanged(): void {
    throw new Error('not used in this test');
  }

  onNoteDeleted(): void {
    throw new Error('not used in this test');
  }
}

class FakeSyncState implements SyncStatePort {
  statuses = new Map<string, Status>();
  lastPoll: string | null = null;
  lastPollCalls: Array<{ projectName: string; iso: string }> = [];

  async get(url: string): Promise<Status | null> {
    return this.statuses.get(url) ?? null;
  }

  async set(status: Status): Promise<void> {
    this.statuses.set(status.url, status);
  }

  async findByNotePath(): Promise<Status | null> {
    return null;
  }

  async remove(): Promise<void> {
    throw new Error('not used in this test');
  }

  async getLastPoll(): Promise<string | null> {
    return this.lastPoll;
  }

  async setLastPoll(projectName: string, iso: string): Promise<void> {
    this.lastPollCalls.push({ projectName, iso });
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  tasks: TaskData[] = [];
  sinceCalls: string[] = [];

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }

  async fetchChangedTasks(since: string): Promise<TaskData[]> {
    this.sinceCalls.push(since);
    return this.tasks;
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
}

const context = { projectName: 'Acme Widgets', syncedAt: '2026-09-18T12:00:00Z' };

const taskA: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: ['type:task'],
};

const taskB: TaskData = {
  url: 'https://github.com/acme/widgets/issues/43',
  remoteId: 43,
  title: 'Add a feature',
  body: 'A new feature.',
  state: 'open',
  updatedAt: '2026-09-18T11:00:00Z',
  labels: ['type:task'],
};

describe('SyncProjectAction', () => {
  it('fetches since the last poll, applies existing and creates new, then advances the cursor', async () => {
    // Given — a last poll cursor, one task with a changed status and one new
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.lastPoll = '2026-09-18T10:00:00Z';
    const { path: pathA } = TaskNoteMapper.map(taskA, context);
    syncState.statuses.set(taskA.url, {
      url: taskA.url,
      remoteId: taskA.remoteId,
      notePath: pathA,
      lastSyncedBodyHash: hash('old body'),
      lastSyncedRemoteUpdatedAt: '2026-09-18T09:00:00Z',
      lastSyncedStatus: 'open',
      lastSyncedTitle: taskA.title,
    });
    // The existing note holds the old body, so the remote change rewrites it
    const oldTaskA: TaskData = { ...taskA, body: 'old body' };
    vault.notes.set(pathA, TaskNoteMapper.map(oldTaskA, context).content);

    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [taskA, taskB];

    const createTaskNote = new CreateTaskNoteAction(vault, syncState);
    const applyRemoteChange = new ApplyRemoteChangeAction(vault, syncState, createTaskNote);
    const action = new SyncProjectAction(projectManagement, syncState, applyRemoteChange, createTaskNote);

    // When — the project is synced
    await action.execute(context);

    // Then — tasks are fetched since the last poll
    expect(projectManagement.sinceCalls).toEqual(['2026-09-18T10:00:00Z']);
    // And the existing task is applied (rewritten) while the new one is created
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.path).toBe(pathA);
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(TaskNoteMapper.map(taskB, context).path);
    // And the cursor is advanced to the sync time
    expect(syncState.lastPollCalls).toEqual([
      { projectName: 'Acme Widgets', iso: '2026-09-18T12:00:00Z' },
    ]);
  });

  it('fetches since the epoch when no last poll exists', async () => {
    // Given — no last poll cursor yet
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.lastPoll = null;
    const projectManagement = new FakeProjectManagement();
    projectManagement.tasks = [];
    const createTaskNote = new CreateTaskNoteAction(vault, syncState);
    const applyRemoteChange = new ApplyRemoteChangeAction(vault, syncState, createTaskNote);
    const action = new SyncProjectAction(projectManagement, syncState, applyRemoteChange, createTaskNote);

    // When — the project is synced
    await action.execute(context);

    // Then — tasks are fetched since the epoch (first poll materialises all)
    expect(projectManagement.sinceCalls).toEqual(['1970-01-01T00:00:00.000Z']);
  });
});
