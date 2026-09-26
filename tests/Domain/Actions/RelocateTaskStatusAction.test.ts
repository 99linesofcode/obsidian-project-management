import { describe, expect, it } from 'vitest';
import { RelocateTaskStatusAction } from '../../../src/Domain/Actions/RelocateTaskStatusAction.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

// Fakes at the sync-state port: an in-memory record list that records every
// save, so the relocate's single decision (move the record or not) is
// observable.
class FakeSyncState implements SyncStatePort {
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }

  async setLastProjectUpdate(): Promise<void> {}
  async getArchiveBaseline(): Promise<null> {
    return null;
  }
  async getWatchState(): Promise<{
    etag: string | null;
    cursor: string | null;
  }> {
    return { etag: null, cursor: null };
  }

  async setWatchState(): Promise<void> {}

  async getTodoistProjectState(): Promise<null> {
    return null;
  }
  async setTodoistProjectState(): Promise<void> {}
  todoistState: TaskData | null = null;
  todoistSets: Array<{ notePath: string; state: TaskData }> = [];
  async getTodoistState(): Promise<TaskData | null> {
    return this.todoistState;
  }
  async setTodoistState(notePath: string, state: TaskData): Promise<void> {
    this.todoistSets.push({ notePath, state });
  }
  async listTodoistStates(): Promise<[]> {
    return [];
  }
  async removeTodoistState(): Promise<void> {}

  async setArchiveBaseline(): Promise<void> {}
  records: TaskData[] = [];
  saved: TaskData[] = [];

  async get(): Promise<TaskData | null> {
    return null;
  }
  async set(status: TaskData): Promise<void> {
    this.saved.push(status);
  }
  async findByNotePath(notePath: string): Promise<TaskData | null> {
    return this.records.find((record) => record.notePath === notePath) ?? null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<TaskData[]> {
    return this.records;
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return null;
  }
}

const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const newPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug-v2.md';

function record(notePath: string): TaskData {
  return taskRecord({
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    notePath,
    body: 'abc',
    updatedAt: '2026-09-18T11:00:00Z',
    status: 'Building',
    title: 'Fix the bug',
  });
}

describe('RelocateTaskStatusAction', () => {
  it("moves the TaskData record's notePath to the new path", async () => {
    // Given — a TaskData record pointing at the note's old path
    const syncState = new FakeSyncState();
    syncState.records.push(record(oldPath));
    const action = new RelocateTaskStatusAction(syncState);

    // When — the task note rename is followed
    await action.execute({ oldPath, newPath });

    // Then — the record is saved under the new path, its fields intact
    expect(syncState.saved).toEqual([
      { ...record(oldPath), notePath: newPath },
    ]);
  });

  it('does nothing when no record matches the old path', async () => {
    // Given — no TaskData record for the renamed note
    const syncState = new FakeSyncState();
    const action = new RelocateTaskStatusAction(syncState);

    // When — the task note rename is followed
    await action.execute({ oldPath, newPath });

    // Then — nothing is saved
    expect(syncState.saved).toEqual([]);
  });

  it('moves the Todoist bookkeeping record to the new path', async () => {
    // Given — a TodoistState record at the note's old path
    const syncState = new FakeSyncState();
    syncState.todoistState = taskRecord({
      todoistId: 'T1',
      notePath: oldPath,
      completed: false,
    });
    const action = new RelocateTaskStatusAction(syncState);

    // When — the task note rename is followed
    await action.execute({ oldPath, newPath });

    // Then — the record is re-keyed to the new path
    expect(syncState.todoistSets).toEqual([
      {
        notePath: newPath,
        state: taskRecord({ todoistId: 'T1', notePath: newPath }),
      },
    ]);
  });
});
