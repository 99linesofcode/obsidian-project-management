import { describe, expect, it } from 'vitest';
import { RelinkRenamedTodoAction } from '../../src/todoist/RelinkRenamedTodoAction.js';
import { splitFrontmatter } from '../../src/vault/splitFrontmatter.js';
import { ToDoNoteMapper } from '../../src/vault/ToDoNoteMapper.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the vault port: a path-keyed note store that records writes, so the
// relink's single decision (rewrite the line or not) is observable.
class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
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

describe('REN-1 — a rename relinks the checklist', () => {
  it('relinks the parent line when the to-do is renamed by hand', async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${oldPath}|Fix the bug]]`));
    vault.notes.set(newPath, toDoNote());
    const action = new RelinkRenamedTodoAction(vault, new FakeSyncState());

    await action.execute({ oldPath, newPath, syncedAt });

    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${newPath}|Fix the bug]]`,
    );
    expect(vault.written.map((entry) => entry.path)).toEqual([taskPath]);
  });

  it('does nothing when no line links the old path (the programmatic echo)', async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${newPath}|Fix the bug]]`));
    vault.notes.set(newPath, toDoNote());
    const action = new RelinkRenamedTodoAction(vault, new FakeSyncState());

    await action.execute({ oldPath, newPath, syncedAt });

    expect(vault.written).toEqual([]);
  });

  it("moves the to-do's registry record to the new path", async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${oldPath}|Fix the bug]]`));
    vault.notes.set(newPath, toDoNote());
    const syncState = new FakeSyncState();
    syncState.seed(entityRecord({ id: 'uuid-todo', notePath: oldPath }), {
      todoist: {
        handle: 'T9',
        base: taskData({ id: 'uuid-todo', status: 'open' }),
      },
    });
    const action = new RelinkRenamedTodoAction(vault, syncState);

    await action.execute({ oldPath, newPath, syncedAt });

    const record = await syncState.get('uuid-todo');
    expect(record?.notePath).toBe(newPath);
    expect(syncState.handleOf('uuid-todo', 'todoist')).toBe('T9');
    expect(await syncState.findByNotePath(oldPath)).toBeNull();
    expect(await syncState.findByNotePath(newPath)).toBe(record);
  });
});
