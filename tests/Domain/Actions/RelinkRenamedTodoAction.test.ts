import { describe, expect, it } from 'vitest';
import { RelinkRenamedTodoAction } from '../../../src/Domain/Actions/RelinkRenamedTodoAction.js';
import { splitFrontmatter } from '../../../src/Domain/Notes/splitFrontmatter.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';
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
    const action = new RelinkRenamedTodoAction(vault);

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
    const action = new RelinkRenamedTodoAction(vault);

    // When — the rename echo arrives
    await action.execute({ oldPath, newPath, syncedAt });

    // Then — no write happens (the chain settles)
    expect(vault.written).toEqual([]);
  });

  it('does nothing when the to-do note is gone', async () => {
    // Given — a parent line whose renamed to-do no longer exists
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${oldPath}|Fix the bug]]`));
    const action = new RelinkRenamedTodoAction(vault);

    // When — the rename is followed
    await action.execute({ oldPath, newPath, syncedAt });

    // Then — no write happens
    expect(vault.written).toEqual([]);
  });

  it('does nothing when the parent task note is gone', async () => {
    // Given — a to-do whose parent task note does not exist
    const vault = new FakeVault();
    vault.notes.set(newPath, toDoNote());
    const action = new RelinkRenamedTodoAction(vault);

    // When — the rename is followed
    await action.execute({ oldPath, newPath, syncedAt });

    // Then — no write happens
    expect(vault.written).toEqual([]);
  });
});
