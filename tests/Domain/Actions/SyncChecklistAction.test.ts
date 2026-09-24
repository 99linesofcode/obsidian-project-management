import { describe, expect, it } from 'vitest';
import { SyncChecklistAction } from '../../../src/Domain/Actions/SyncChecklistAction.js';
import { splitFrontmatter } from '../../../src/Domain/Notes/splitFrontmatter.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';
import { ToDoNoteParser } from '../../../src/Domain/Notes/ToDoNoteParser.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the vault port: a path-keyed note store that records every create,
// write and trash, so the action's own lifecycle decisions are observable.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  written: Array<{ path: string; content: string }> = [];
  renamed: Array<{ oldPath: string; newPath: string }> = [];
  trashed: string[] = [];

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

  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = this.notes.get(oldPath);
    if (content === undefined) {
      return;
    }
    this.notes.delete(oldPath);
    this.notes.set(newPath, content);
    this.renamed.push({ oldPath, newPath });
  }

  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }

  async trashNote(path: string): Promise<void> {
    this.notes.delete(path);
    this.trashed.push(path);
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

const input = { title: 'Fix the bug', projectName, taskLink };

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

describe('SyncChecklistAction', () => {
  it('promotes an unlinked item: creates the to-do and links the line', async () => {
    // Given — a task note whose checklist item has no to-do yet
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the to-do is created with its affiliation and open status
    const expected = ToDoNoteMapper.render(null, input, {
      syncedAt,
      statusName: 'open',
    });
    expect(vault.created).toEqual([
      { path: todoPath, content: expected.content },
    ]);
    expect(ToDoNoteParser.parse(vault.notes.get(todoPath)!)).toEqual({
      status: 'open',
      completed: null,
      affiliation: ['[[Acme Widgets]]', '[[42-fix-the-bug]]'],
    });

    // And the task note's line now carries the link
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      '- [ ] [[Projecten/Acme Widgets/todos/fix-the-bug.md|Fix the bug]]',
    );
    expect(vault.written.map((entry) => entry.path)).toEqual([taskPath]);
  });

  it('suffixes the slug until the to-do path is free', async () => {
    // Given — a to-do note already occupying the item's slug
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));
    vault.notes.set(todoPath, 'already here');
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the new to-do lands on the next free slug and the line links to it
    expect(vault.created.map((entry) => entry.path)).toEqual([
      'Projecten/Acme Widgets/todos/fix-the-bug-2.md',
    ]);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      '- [ ] [[Projecten/Acme Widgets/todos/fix-the-bug-2.md|Fix the bug]]',
    );
  });

  it('renders the to-do through the vault template', async () => {
    // Given — a configured to-do template
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));
    const template = [
      '---',
      'affiliation: []',
      'status:',
      'completed:',
      'created: {{date}}',
      '---',
    ].join('\n');
    vault.notes.set('Templates/ToDo.md', template);
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the created to-do is the rendered template
    const expected = ToDoNoteMapper.render(template, input, {
      syncedAt,
      statusName: 'open',
    });
    expect(vault.created).toEqual([
      { path: todoPath, content: expected.content },
    ]);
  });

  it('marks a checked item completed with the sync stamp', async () => {
    // Given — a linked item checked in the note, its to-do still open
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [x] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(input, { syncedAt, statusName: 'open' }).content,
    );
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the to-do carries the completed status and the sync stamp
    const parsed = ToDoNoteParser.parse(vault.notes.get(todoPath)!);
    expect(parsed?.status).toBe('completed');
    expect(parsed?.completed).toBe(syncedAt);
    expect(vault.written.map((entry) => entry.path)).toEqual([todoPath]);
  });

  it('reopens a completed to-do when its item is unchecked', async () => {
    // Given — a linked item unchecked in the note, its to-do completed
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(input, {
        syncedAt,
        statusName: 'completed',
        completedAt: '2026-09-18T13:00:00Z',
      }).content,
    );
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the to-do is open again with a cleared stamp
    const parsed = ToDoNoteParser.parse(vault.notes.get(todoPath)!);
    expect(parsed?.status).toBe('open');
    expect(parsed?.completed).toBeNull();
  });

  it('re-creates a to-do when the line links to a missing note', async () => {
    // Given — a linked item whose to-do note does not exist
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the to-do is re-created at the exact linked path, open
    expect(vault.created.map((entry) => entry.path)).toEqual([todoPath]);
    expect(ToDoNoteParser.parse(vault.notes.get(todoPath)!)?.status).toBe(
      'open',
    );

    // And the already-linked task note is not rewritten
    expect(vault.written).toEqual([]);
  });

  it('trashes a to-do whose checklist line was removed', async () => {
    // Given — a to-do for the task, and a note with no checklist line left
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote('No items left.'));
    vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(input, { syncedAt, statusName: 'open' }).content,
    );
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the orphaned to-do is moved to the trash
    expect(vault.trashed).toEqual([todoPath]);
    expect(vault.notes.has(todoPath)).toBe(false);
  });

  it('keeps a to-do that belongs to another task', async () => {
    // Given — a to-do affiliated with a different task
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote('No items left.'));
    const otherPath = 'Projecten/Acme Widgets/todos/other.md';
    vault.notes.set(
      otherPath,
      ToDoNoteMapper.map(
        { title: 'Other', projectName, taskLink: '99-other' },
        { syncedAt, statusName: 'open' },
      ).content,
    );
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the other task's to-do is untouched
    expect(vault.trashed).toEqual([]);
    expect(vault.notes.has(otherPath)).toBe(true);
  });

  it('renames the to-do when the item text drifts from its filename', async () => {
    // Given — a linked item whose to-do filename is a stale slug
    const vault = new FakeVault();
    const stalePath = 'Projecten/Acme Widgets/todos/fi.md';
    vault.notes.set(taskPath, taskNote(`- [ ] [[${stalePath}|Fix the bug]]`));
    const todoContent = ToDoNoteMapper.map(input, {
      syncedAt,
      statusName: 'open',
    }).content;
    vault.notes.set(stalePath, todoContent);
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the to-do is renamed to the item's slug, its content unchanged
    expect(vault.renamed).toEqual([{ oldPath: stalePath, newPath: todoPath }]);
    expect(vault.notes.get(todoPath)).toBe(todoContent);
    expect(vault.notes.has(stalePath)).toBe(false);

    // And the parent line points at the new path
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });

  it('leaves a to-do whose filename already matches the item text', async () => {
    // Given — a linked item whose to-do filename is the exact slug
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(input, { syncedAt, statusName: 'open' }).content,
    );
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — nothing is renamed or rewritten
    expect(vault.renamed).toEqual([]);
    expect(vault.written).toEqual([]);
  });

  it('leaves a collision-suffixed to-do alone', async () => {
    // Given — the second "test" item's to-do carries the -2 collision suffix
    const vault = new FakeVault();
    const collisionPath = 'Projecten/Acme Widgets/todos/test-2.md';
    vault.notes.set(taskPath, taskNote(`- [ ] [[${collisionPath}|test]]`));
    vault.notes.set(
      collisionPath,
      ToDoNoteMapper.map(
        { title: 'test', projectName, taskLink },
        { syncedAt, statusName: 'open' },
      ).content,
    );
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the suffix is tolerated, not read as drift
    expect(vault.renamed).toEqual([]);
    expect(vault.written).toEqual([]);
  });

  it('suffixes the rename target when the slug is already taken', async () => {
    // Given — a drifted to-do and another note already on the target slug
    const vault = new FakeVault();
    const stalePath = 'Projecten/Acme Widgets/todos/fi.md';
    vault.notes.set(taskPath, taskNote(`- [ ] [[${stalePath}|Fix the bug]]`));
    vault.notes.set(
      stalePath,
      ToDoNoteMapper.map(input, { syncedAt, statusName: 'open' }).content,
    );
    vault.notes.set(todoPath, 'already here');
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the rename lands on the next free slug and the line follows
    const suffixed = 'Projecten/Acme Widgets/todos/fix-the-bug-2.md';
    expect(vault.renamed).toEqual([
      { oldPath: stalePath, newPath: suffixed },
    ]);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${suffixed}|Fix the bug]]`,
    );
  });

  it('rewrites the parent body once when promotion and drift both change links', async () => {
    // Given — a note with an unlinked item and a drifted linked item
    const vault = new FakeVault();
    const stalePath = 'Projecten/Acme Widgets/todos/fi.md';
    vault.notes.set(
      taskPath,
      taskNote(
        ['- [ ] New item', `- [ ] [[${stalePath}|Fix the bug]]`].join('\n'),
      ),
    );
    vault.notes.set(
      stalePath,
      ToDoNoteMapper.map(input, { syncedAt, statusName: 'open' }).content,
    );
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');

    // When — the checklist is synced
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the parent body is written exactly once, carrying both links
    const parentWrites = vault.written.filter(
      (entry) => entry.path === taskPath,
    );
    expect(parentWrites).toHaveLength(1);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      [
        '- [ ] [[Projecten/Acme Widgets/todos/new-item.md|New item]]',
        `- [ ] [[${todoPath}|Fix the bug]]`,
      ].join('\n'),
    );
  });

  it('performs zero writes on a second pass after a drift rename', async () => {
    // Given — a note whose to-do was renamed on the first pass
    const vault = new FakeVault();
    const stalePath = 'Projecten/Acme Widgets/todos/fi.md';
    vault.notes.set(taskPath, taskNote(`- [ ] [[${stalePath}|Fix the bug]]`));
    vault.notes.set(
      stalePath,
      ToDoNoteMapper.map(input, { syncedAt, statusName: 'open' }).content,
    );
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // When — the settled note is synced again (the echo from the rewrite)
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — the second pass renames nothing and writes nothing
    expect(vault.renamed).toHaveLength(1);
    expect(vault.written).toHaveLength(1);
    expect(vault.created).toHaveLength(0);
    expect(vault.trashed).toHaveLength(0);
  });

  it('performs zero writes on a second, settled pass', async () => {
    // Given — a note that has already been synced once
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));
    const action = new SyncChecklistAction(vault, 'Templates/ToDo.md');
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // When — the settled note is synced again (the echo from the rewrite)
    await action.execute({ notePath: taskPath, projectName, syncedAt });

    // Then — no create, write or trash happens on the second pass
    expect(vault.created).toHaveLength(1);
    expect(vault.written).toHaveLength(1);
    expect(vault.trashed).toHaveLength(0);
  });
});
