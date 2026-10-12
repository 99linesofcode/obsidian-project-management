import { describe, expect, it } from 'vitest';
import { MirrorTodoStatusAction } from '../../../../src/core/application/actions/MirrorTodoStatusAction.js';
import { splitFrontmatter } from '../../../../src/core/domain/note.js';
import { TaskNoteMapper } from '../../../../src/core/application/actions/create-task-note/TaskNoteMapper.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

// Fakes at the vault port: a path-keyed note store that records writes, so the
// mirror's single decision (flip the checkbox or not) is observable.
class FakeVault extends FakeVaultBase {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Map<string, string>();
  written: Array<{ path: string; content: string }> = [];

  override async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async createNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }

  async moveFolder(): Promise<void> {}
  override async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  override onNoteChanged(): void {}
  override onNoteDeleted(): void {}
  override onNoteRenamed(): void {}
}

const projectName = 'Acme Widgets';
const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const taskLink = '42-fix-the-bug';
const todoPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
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
  return TaskNoteMapper.map(
    { type: 'todo', title: 'Fix the bug', body: '', createdAt: null },
    {
      projectName,
      syncedAt,
      statusName: status,
      parentLink: taskLink,
    },
  ).content;
}

describe('TODO-2 — a to-do state mirrors to its note', () => {
  it('checks the parent line when its to-do is completed', async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, toDoNote('completed'));
    const action = new MirrorTodoStatusAction(vault);

    await action.execute({ todoPath, syncedAt });

    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [x] [[${todoPath}|Fix the bug]]`,
    );
    expect(vault.written.map((entry) => entry.path)).toEqual([taskPath]);
  });

  it('unchecks the parent line when its to-do is reopened', async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [x] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, toDoNote('open'));
    const action = new MirrorTodoStatusAction(vault);

    await action.execute({ todoPath, syncedAt });

    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });

  it('does nothing when the parent line already agrees', async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [x] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, toDoNote('completed'));
    const action = new MirrorTodoStatusAction(vault);

    await action.execute({ todoPath, syncedAt });

    expect(vault.written).toEqual([]);
  });

  it('does nothing when the parent has no line linking the to-do', async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote('No items left.'));
    vault.notes.set(todoPath, toDoNote('completed'));
    const action = new MirrorTodoStatusAction(vault);

    await action.execute({ todoPath, syncedAt });

    expect(vault.written).toEqual([]);
  });

  it('does nothing when the to-do note is gone', async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    const action = new MirrorTodoStatusAction(vault);

    await action.execute({ todoPath, syncedAt });

    expect(vault.written).toEqual([]);
  });
});
