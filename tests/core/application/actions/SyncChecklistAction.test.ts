import { beforeEach, describe, expect, it } from 'vitest';
import { SyncChecklistAction } from '../../../../src/core/application/actions/SyncChecklistAction.js';
import { splitFrontmatter } from '../../../../src/core/domain/splitFrontmatter.js';
import { ToDoNoteMapper } from '../../../../src/core/domain/ToDoNoteMapper.js';
import { ToDoNoteParser } from '../../../../src/core/domain/ToDoNoteParser.js';
import type { NoteEnumeratorPort } from '../../../../src/core/port/NoteEnumeratorPort.js';
import type { NoteReaderPort } from '../../../../src/core/port/NoteReaderPort.js';
import type { NoteWriterPort } from '../../../../src/core/port/NoteWriterPort.js';
import type { VaultEventPort } from '../../../../src/core/port/VaultEventPort.js';

class FakeVault
  implements NoteReaderPort, NoteWriterPort, NoteEnumeratorPort, VaultEventPort
{
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
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

  async moveFolder(): Promise<void> {}
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

function openTodo(): string {
  return ToDoNoteMapper.map(input, { syncedAt, statusName: 'open' }).content;
}

let vault: FakeVault;
let action: SyncChecklistAction;

beforeEach(() => {
  vault = new FakeVault();
  action = new SyncChecklistAction(vault, 'Templates/ToDo.md');
});

describe('TODO-1 — an unlinked checklist line materializes its to-do', () => {
  it('creates the to-do with its affiliation and open status, and links the line', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

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
      affiliation: ['[[_Acme Widgets]]', '[[42-fix-the-bug]]'],
    });
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      '- [ ] [[Projecten/Acme Widgets/todos/fix-the-bug.md|Fix the bug]]',
    );
    expect(vault.written.map((entry) => entry.path)).toEqual([taskPath]);
  });

  it('suffixes the slug until the to-do path is free', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));
    vault.notes.set(todoPath, 'already here');

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([
      'Projecten/Acme Widgets/todos/fix-the-bug-2.md',
    ]);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      '- [ ] [[Projecten/Acme Widgets/todos/fix-the-bug-2.md|Fix the bug]]',
    );
  });

  it('renders the to-do through the vault template', async () => {
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

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    const expected = ToDoNoteMapper.render(template, input, {
      syncedAt,
      statusName: 'open',
    });
    expect(vault.created).toEqual([
      { path: todoPath, content: expected.content },
    ]);
  });
});

describe('TODO-2 — checklist state mirrors to the to-do', () => {
  it('marks a checked item completed with the sync stamp', async () => {
    vault.notes.set(taskPath, taskNote(`- [x] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, openTodo());

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    const parsed = ToDoNoteParser.parse(vault.notes.get(todoPath)!);
    expect(parsed?.status).toBe('completed');
    expect(parsed?.completed).toBe(syncedAt);
    expect(vault.written.map((entry) => entry.path)).toEqual([todoPath]);
  });

  it('reopens a completed to-do when its item is unchecked', async () => {
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(input, {
        syncedAt,
        statusName: 'completed',
        completedAt: '2026-09-18T13:00:00Z',
      }).content,
    );

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    const parsed = ToDoNoteParser.parse(vault.notes.get(todoPath)!);
    expect(parsed?.status).toBe('open');
    expect(parsed?.completed).toBeNull();
  });

  it('re-creates a to-do when the line links to a missing note', async () => {
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([todoPath]);
    expect(ToDoNoteParser.parse(vault.notes.get(todoPath)!)?.status).toBe(
      'open',
    );
    expect(vault.written).toEqual([]);
  });

  it('relinks a bare link to the existing to-do instead of creating at the root', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] [[fix-the-bug|Fix the bug]]'));
    vault.notes.set(todoPath, openTodo());

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created).toEqual([]);
    expect(vault.trashed).toEqual([]);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });

  it('re-promotes a bare link with no matching to-do at the canonical path', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] [[fix-the-bug|Fix the bug]]'));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([todoPath]);
    expect(vault.notes.has('fix-the-bug')).toBe(false);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });

  it('relinks a wrong-folder link to the to-do in todos/', async () => {
    const wrongPath =
      'Projecten/Acme Widgets/taken/promotion-end-to-end-from-obsidian';
    const title = 'Promotion end to end from obsidian';
    vault.notes.set(taskPath, taskNote(`- [ ] [[${wrongPath}|${title}]]`));
    const realPath =
      'Projecten/Acme Widgets/todos/promotion-end-to-end-from-obsidian.md';
    vault.notes.set(
      realPath,
      ToDoNoteMapper.map(
        { title, projectName, taskLink },
        { syncedAt, statusName: 'open' },
      ).content,
    );

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created).toEqual([]);
    expect(vault.notes.has(wrongPath)).toBe(false);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${realPath}|${title}]]`,
    );
  });

  it('never creates a to-do outside todos/ for a malformed link', async () => {
    vault.notes.set(
      taskPath,
      taskNote('- [ ] [[notes/fix-the-bug|Fix the bug]]'),
    );

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([todoPath]);
    expect(vault.notes.has('notes/fix-the-bug')).toBe(false);
  });

  it('renames the to-do when the item text drifts from its filename', async () => {
    const stalePath = 'Projecten/Acme Widgets/todos/fi.md';
    vault.notes.set(taskPath, taskNote(`- [ ] [[${stalePath}|Fix the bug]]`));
    vault.notes.set(stalePath, openTodo());

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.renamed).toEqual([{ oldPath: stalePath, newPath: todoPath }]);
    expect(vault.notes.get(todoPath)).toBe(openTodo());
    expect(vault.notes.has(stalePath)).toBe(false);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });

  it('leaves an already-correct to-do alone, suffix tolerated', async () => {
    const cases = [
      {
        name: 'exact slug',
        path: todoPath,
        line: todoPath,
        title: 'Fix the bug',
      },
      {
        name: 'collision suffix',
        path: 'Projecten/Acme Widgets/todos/test-2.md',
        line: 'Projecten/Acme Widgets/todos/test-2.md',
        title: 'test',
      },
    ];
    for (const { name, path, line, title } of cases) {
      const local = new FakeVault();
      const localAction = new SyncChecklistAction(local, 'Templates/ToDo.md');
      local.notes.set(taskPath, taskNote(`- [ ] [[${line}|${title}]]`));
      local.notes.set(
        path,
        ToDoNoteMapper.map(
          { title, projectName, taskLink },
          { syncedAt, statusName: 'open' },
        ).content,
      );

      await localAction.execute({ notePath: taskPath, projectName, syncedAt });

      expect(local.renamed, name).toEqual([]);
      expect(local.written, name).toEqual([]);
    }
  });

  it('suffixes the rename target when the slug is already taken', async () => {
    const stalePath = 'Projecten/Acme Widgets/todos/fi.md';
    vault.notes.set(taskPath, taskNote(`- [ ] [[${stalePath}|Fix the bug]]`));
    vault.notes.set(stalePath, openTodo());
    vault.notes.set(todoPath, 'already here');

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    const suffixed = 'Projecten/Acme Widgets/todos/fix-the-bug-2.md';
    expect(vault.renamed).toEqual([{ oldPath: stalePath, newPath: suffixed }]);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${suffixed}|Fix the bug]]`,
    );
  });

  it('rewrites the parent body once when promotion and drift both change links', async () => {
    const stalePath = 'Projecten/Acme Widgets/todos/fi.md';
    vault.notes.set(
      taskPath,
      taskNote(
        ['- [ ] New item', `- [ ] [[${stalePath}|Fix the bug]]`].join('\n'),
      ),
    );
    vault.notes.set(stalePath, openTodo());

    await action.execute({ notePath: taskPath, projectName, syncedAt });

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
});

describe('TODO-4 — a removed line removes its to-do', () => {
  it('trashes a to-do whose checklist line was removed', async () => {
    vault.notes.set(taskPath, taskNote('No items left.'));
    vault.notes.set(todoPath, openTodo());

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.trashed).toEqual([todoPath]);
    expect(vault.notes.has(todoPath)).toBe(false);
  });

  it('keeps a to-do this task is not the primary parent of', async () => {
    vault.notes.set(taskPath, taskNote('No items left.'));
    const rewritten = 'Projecten/Acme Widgets/todos/rewritten.md';
    vault.notes.set(
      rewritten,
      ToDoNoteMapper.map(
        { title: 'Rewritten', projectName, taskLink: '99-other' },
        { syncedAt, statusName: 'open' },
      ).content.replace(
        '"[[99-other]]"',
        '"[[99-other]]", "[[42-fix-the-bug]]"',
      ),
    );
    const otherPath = 'Projecten/Acme Widgets/todos/other.md';
    vault.notes.set(
      otherPath,
      ToDoNoteMapper.map(
        { title: 'Other', projectName, taskLink: '99-other' },
        { syncedAt, statusName: 'open' },
      ).content,
    );

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.trashed).toEqual([]);
    expect(vault.notes.has(rewritten)).toBe(true);
    expect(vault.notes.has(otherPath)).toBe(true);
  });
});

describe('SYNC-8 — a settled checklist pass writes nothing', () => {
  it('performs zero writes on a second pass across every settle path', async () => {
    const stalePath = 'Projecten/Acme Widgets/todos/fi.md';
    const wrongPath =
      'Projecten/Acme Widgets/taken/promotion-end-to-end-from-obsidian';
    const wrongTitle = 'Promotion end to end from obsidian';
    const realPath =
      'Projecten/Acme Widgets/todos/promotion-end-to-end-from-obsidian.md';
    const rows: Array<{
      name: string;
      prepare: (v: FakeVault) => void;
      expectedCreated: number;
      expectedWritten: number;
    }> = [
      {
        name: 'drift rename',
        prepare: (v) => {
          v.notes.set(taskPath, taskNote(`- [ ] [[${stalePath}|Fix the bug]]`));
          v.notes.set(stalePath, openTodo());
        },
        expectedCreated: 0,
        expectedWritten: 1,
      },
      {
        name: 'plain settle',
        prepare: (v) => {
          v.notes.set(taskPath, taskNote('- [ ] Fix the bug'));
        },
        expectedCreated: 1,
        expectedWritten: 1,
      },
      {
        name: 'bare-link relink',
        prepare: (v) => {
          v.notes.set(taskPath, taskNote('- [ ] [[fix-the-bug|Fix the bug]]'));
          v.notes.set(todoPath, openTodo());
        },
        expectedCreated: 0,
        expectedWritten: 1,
      },
      {
        name: 'bare-link re-promotion',
        prepare: (v) => {
          v.notes.set(taskPath, taskNote('- [ ] [[fix-the-bug|Fix the bug]]'));
        },
        expectedCreated: 1,
        expectedWritten: 1,
      },
      {
        name: 'wrong-folder relink',
        prepare: (v) => {
          v.notes.set(
            taskPath,
            taskNote(`- [ ] [[${wrongPath}|${wrongTitle}]]`),
          );
          v.notes.set(
            realPath,
            ToDoNoteMapper.map(
              { title: wrongTitle, projectName, taskLink },
              { syncedAt, statusName: 'open' },
            ).content,
          );
        },
        expectedCreated: 0,
        expectedWritten: 1,
      },
    ];

    for (const { name, prepare, expectedCreated, expectedWritten } of rows) {
      const local = new FakeVault();
      const localAction = new SyncChecklistAction(local, 'Templates/ToDo.md');
      prepare(local);
      await localAction.execute({ notePath: taskPath, projectName, syncedAt });

      await localAction.execute({ notePath: taskPath, projectName, syncedAt });

      expect(local.created, name).toHaveLength(expectedCreated);
      expect(local.written, name).toHaveLength(expectedWritten);
      expect(local.renamed.length, name).toBeLessThanOrEqual(1);
      expect(local.trashed, name).toHaveLength(0);
    }
  });
});
