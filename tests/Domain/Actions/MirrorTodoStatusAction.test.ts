import { describe, expect, it } from 'vitest';
import { MirrorTodoStatusAction } from '../../../src/Domain/Actions/MirrorTodoStatusAction.js';
import { splitFrontmatter } from '../../../src/Domain/Notes/splitFrontmatter.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the vault port: a path-keyed note store that records writes, so the
// mirror's single decision (flip the checkbox or not) is observable.
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
const todoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
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

function toDoNote(status: 'open' | 'completed'): string {
  return ToDoNoteMapper.map(
    { title: 'Fix the bug', projectName, taskLink },
    {
      syncedAt,
      statusName: status,
      ...(status === 'completed' ? { completedAt: syncedAt } : {}),
    },
  ).content;
}

describe('MirrorTodoStatusAction', () => {
  it('checks the parent line when its to-do is completed', async () => {
    // Given — a to-do completed, its parent line still unchecked
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, toDoNote('completed'));
    const action = new MirrorTodoStatusAction(vault);

    // When — the to-do change is mirrored
    await action.execute({ todoPath, syncedAt });

    // Then — the parent line is checked
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [x] [[${todoPath}|Fix the bug]]`,
    );
    expect(vault.written.map((entry) => entry.path)).toEqual([taskPath]);
  });

  it('unchecks the parent line when its to-do is reopened', async () => {
    // Given — a to-do reopened, its parent line still checked
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [x] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, toDoNote('open'));
    const action = new MirrorTodoStatusAction(vault);

    // When — the to-do change is mirrored
    await action.execute({ todoPath, syncedAt });

    // Then — the parent line is unchecked
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });

  it('does nothing when the parent line already agrees', async () => {
    // Given — a completed to-do and a checked parent line
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [x] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, toDoNote('completed'));
    const action = new MirrorTodoStatusAction(vault);

    // When — the to-do change is mirrored
    await action.execute({ todoPath, syncedAt });

    // Then — no write happens (the echo settles)
    expect(vault.written).toEqual([]);
  });

  it('does nothing when the parent has no line linking the to-do', async () => {
    // Given — a completed to-do whose line was removed from the parent
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote('No items left.'));
    vault.notes.set(todoPath, toDoNote('completed'));
    const action = new MirrorTodoStatusAction(vault);

    // When — the to-do change is mirrored
    await action.execute({ todoPath, syncedAt });

    // Then — no write happens
    expect(vault.written).toEqual([]);
  });

  it('does nothing when the to-do note is gone', async () => {
    // Given — a parent line whose to-do note no longer exists
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    const action = new MirrorTodoStatusAction(vault);

    // When — the change is mirrored
    await action.execute({ todoPath, syncedAt });

    // Then — no write happens
    expect(vault.written).toEqual([]);
  });
});
