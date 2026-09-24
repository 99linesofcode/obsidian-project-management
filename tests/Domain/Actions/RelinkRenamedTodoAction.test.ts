import { describe, expect, it } from 'vitest';
import { RelinkRenamedTodoAction } from '../../../src/Domain/Actions/RelinkRenamedTodoAction.js';
import { splitFrontmatter } from '../../../src/Domain/Notes/splitFrontmatter.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TodoistProjectStateData } from '../../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistStateData } from '../../../src/Domain/DataTransferObjects/TodoistStateData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the vault port: a path-keyed note store that records writes, so the
// relink's single decision (rewrite the line or not) is observable.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  written: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async createNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }

  async moveFolder(): Promise<void> {}
  async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }

  async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

// A sync-state fake that only exercises the Todoist item bookkeeping the
// relink now moves; every other method is inert.
class FakeSyncState implements SyncStatePort {
  todoistItemStates = new Map<string, TodoistStateData>();
  todoistItemSets: Array<{ notePath: string; state: TodoistStateData }> = [];

  async getTodoistState(notePath: string): Promise<TodoistStateData | null> {
    return this.todoistItemStates.get(notePath) ?? null;
  }
  async setTodoistState(
    notePath: string,
    state: TodoistStateData,
  ): Promise<void> {
    this.todoistItemSets.push({ notePath, state });
    this.todoistItemStates.set(notePath, state);
  }

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
  async listTodoistStates(): Promise<TodoistStateData[]> {
    return [...this.todoistItemStates.values()];
  }
  async removeTodoistState(notePath: string): Promise<void> {
    this.todoistItemStates.delete(notePath);
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
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
  async getTodoistProjectState(): Promise<TodoistProjectStateData | null> {
    return null;
  }
  async setTodoistProjectState(): Promise<void> {}
}

const projectName = 'Acme Widgets';
const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const taskLink = '42-fix-the-bug';
const oldPath = 'Projecten/Acme Widgets/todos/fi.md';
const newPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
const syncedAt = '2026-09-18T12:00:00Z';

function taskNote(body: string): string {
  return [
    '---',
    'url: https://github.com/acme/widgets/issues/42',
    'status: Building',
    'affiliation: ["[[Acme Widgets]]"]',
    `synced: ${syncedAt}`,
    '---',
    body,
  ].join('\n');
}

function bodyOf(content: string): string {
  return splitFrontmatter(content)?.body ?? content;
}

function toDoNote(): string {
  return ToDoNoteMapper.map(
    { title: 'Fix the bug', projectName, taskLink },
    { syncedAt, statusName: 'open' },
  ).content;
}

describe('RelinkRenamedTodoAction', () => {
  it('relinks the parent line when the to-do is renamed by hand', async () => {
    // Given — a parent line linking the to-do's old path, the note at its new
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${oldPath}|Fix the bug]]`));
    vault.notes.set(newPath, toDoNote());
    const action = new RelinkRenamedTodoAction(vault, new FakeSyncState());

    // When — the rename is followed
    await action.execute({ oldPath, newPath, syncedAt });

    // Then — the parent line points at the new path
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${newPath}|Fix the bug]]`,
    );
    expect(vault.written.map((entry) => entry.path)).toEqual([taskPath]);
  });

  it('does nothing when no line links the old path (the programmatic echo)', async () => {
    // Given — the checklist sync already rewrote the line to the new path
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${newPath}|Fix the bug]]`));
    vault.notes.set(newPath, toDoNote());
    const action = new RelinkRenamedTodoAction(vault, new FakeSyncState());

    // When — the rename echo arrives
    await action.execute({ oldPath, newPath, syncedAt });

    // Then — no write happens (the chain settles)
    expect(vault.written).toEqual([]);
  });

  it('does nothing when the to-do note is gone', async () => {
    // Given — a parent line whose renamed to-do no longer exists
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${oldPath}|Fix the bug]]`));
    const action = new RelinkRenamedTodoAction(vault, new FakeSyncState());

    // When — the rename is followed
    await action.execute({ oldPath, newPath, syncedAt });

    // Then — no write happens
    expect(vault.written).toEqual([]);
  });

  it('does nothing when the parent task note is gone', async () => {
    // Given — a to-do whose parent task note does not exist
    const vault = new FakeVault();
    vault.notes.set(newPath, toDoNote());
    const action = new RelinkRenamedTodoAction(vault, new FakeSyncState());

    // When — the rename is followed
    await action.execute({ oldPath, newPath, syncedAt });

    // Then — no write happens
    expect(vault.written).toEqual([]);
  });

  it("moves the to-do's Todoist bookkeeping to the new path", async () => {
    // Given — a to-do with a TodoistState record at its old path
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${oldPath}|Fix the bug]]`));
    vault.notes.set(newPath, toDoNote());
    const syncState = new FakeSyncState();
    syncState.todoistItemStates.set(oldPath, {
      todoistId: 'T9',
      notePath: oldPath,
      lastSyncedHash: 'abc',
      lastSyncedCompleted: false,
    });
    const action = new RelinkRenamedTodoAction(vault, syncState);

    // When — the rename is followed
    await action.execute({ oldPath, newPath, syncedAt });

    // Then — the record is re-keyed to the new path
    expect(syncState.todoistItemSets).toEqual([
      {
        notePath: newPath,
        state: {
          todoistId: 'T9',
          notePath: newPath,
          lastSyncedHash: 'abc',
          lastSyncedCompleted: false,
        },
      },
    ]);
  });
});
