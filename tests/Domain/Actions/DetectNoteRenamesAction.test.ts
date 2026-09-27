import { describe, expect, it } from 'vitest';
import { DetectNoteRenamesAction } from '../../../src/Domain/Actions/DetectNoteRenamesAction.js';
import type { RelinkRenamedTodoAction } from '../../../src/Domain/Actions/RelinkRenamedTodoAction.js';
import type { RelocateTaskStatusAction } from '../../../src/Domain/Actions/RelocateTaskStatusAction.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

class FakeVault implements VaultPort {
  folders = new Map<string, string[]>();
  notes = new Map<string, string>();

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
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeSyncState implements SyncStatePort {
  statuses: TaskData[] = [];
  todoistStates: TaskData[] = [];

  async get(): Promise<TaskData | null> {
    return null;
  }
  async set(): Promise<void> {}
  async findByNotePath(): Promise<TaskData | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<TaskData[]> {
    return this.statuses;
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<null> {
    return null;
  }
  async getLastProjectUpdate(): Promise<null> {
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
  async getTodoistProjectState(): Promise<null> {
    return null;
  }
  async setTodoistProjectState(): Promise<void> {}
  async getTodoistState(): Promise<null> {
    return null;
  }
  async setTodoistState(): Promise<void> {}
  async removeTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<TaskData[]> {
    return this.todoistStates;
  }
}

class FakeRelink {
  calls: Array<{ oldPath: string; newPath: string; syncedAt: string }> = [];
  async execute(input: {
    oldPath: string;
    newPath: string;
    syncedAt: string;
  }): Promise<void> {
    this.calls.push(input);
  }
}

class FakeRelocate {
  calls: Array<{ oldPath: string; newPath: string }> = [];
  async execute(input: { oldPath: string; newPath: string }): Promise<void> {
    this.calls.push(input);
  }
}

function status(notePath: string): TaskData {
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

function todoistState(notePath: string): TaskData {
  return taskRecord({ todoistId: 'T9', notePath });
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const relink = new FakeRelink();
  const relocate = new FakeRelocate();
  const action = new DetectNoteRenamesAction(
    vault,
    syncState,
    relink as unknown as RelinkRenamedTodoAction,
    relocate as unknown as RelocateTaskStatusAction,
  );
  return { action, vault, syncState, relink, relocate };
}

const syncedAt = '2026-09-18T12:00:00Z';

describe('DetectNoteRenamesAction', () => {
  it('relocates a task record whose note was renamed', async () => {
    // Given — a status record at the old path and the note at a new path
    const h = harness();
    h.syncState.statuses = [status('Projecten/Acme Widgets/taken/42-old.md')];
    h.vault.folders.set('Projecten/Acme Widgets/taken', [
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    ]);

    // When — drift is detected
    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — the status record follows the remote id prefix
    expect(h.relocate.calls).toEqual([
      {
        oldPath: 'Projecten/Acme Widgets/taken/42-old.md',
        newPath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      },
    ]);
  });

  it('relinks a to-do record whose note was renamed', async () => {
    // Given — a to-do record at the old path and the note at a new path
    const h = harness();
    h.syncState.todoistStates = [
      todoistState('Projecten/Acme Widgets/todos/fi.md'),
    ];
    h.vault.folders.set('Projecten/Acme Widgets/todos', [
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    ]);

    // When — drift is detected
    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — the to-do relinks to the unclaimed current path
    expect(h.relink.calls).toEqual([
      {
        oldPath: 'Projecten/Acme Widgets/todos/fi.md',
        newPath: 'Projecten/Acme Widgets/todos/fix-the-bug.md',
        syncedAt,
      },
    ]);
  });

  it('leaves a record whose note still exists alone', async () => {
    // Given — a status record whose note is present
    const h = harness();
    h.syncState.statuses = [
      status('Projecten/Acme Widgets/taken/42-fix-the-bug.md'),
    ];
    h.vault.folders.set('Projecten/Acme Widgets/taken', [
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    ]);

    // When — drift is detected
    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — nothing moves
    expect(h.relocate.calls).toEqual([]);
    expect(h.relink.calls).toEqual([]);
  });

  it('leaves a record whose note is gone and has no match alone', async () => {
    // Given — a status record whose note is gone and no current note matches
    const h = harness();
    h.syncState.statuses = [status('Projecten/Acme Widgets/taken/42-gone.md')];
    h.vault.folders.set('Projecten/Acme Widgets/taken', [
      'Projecten/Acme Widgets/taken/99-other.md',
    ]);

    // When — drift is detected
    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — the deletion sweep owns it, not the rename detector
    expect(h.relocate.calls).toEqual([]);
  });
});
