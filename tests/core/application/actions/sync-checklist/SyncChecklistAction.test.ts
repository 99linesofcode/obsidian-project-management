import { beforeEach, describe, expect, it } from 'vitest';
import { SyncChecklistAction } from '../../../../../src/core/application/actions/sync-checklist/SyncChecklistAction.js';
import {
  splitFrontmatter,
  typeFromLabels,
} from '../../../../../src/core/domain/note.js';
import { noteId } from '../../../../../src/core/domain/noteIdentity.js';
import { ToDoNoteParser } from '../../../../../src/core/domain/ToDoNoteParser.js';
import { CanonicalTask } from '../../../../../src/core/port/data/CanonicalTask.js';
import { parseTaskNote } from '../../../../../src/infrastructure/vault/taskNoteCodec.js';
import { FakeVault as FakeVaultBase } from '../../../../helpers/fakeVault.js';

class FakeVault extends FakeVaultBase {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  written: Array<{ path: string; content: string }> = [];
  renamed: Array<{ oldPath: string; newPath: string }> = [];
  trashed: string[] = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  override async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }

  async moveFolder(): Promise<void> {}
  override async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = this.notes.get(oldPath);
    if (content === undefined) {
      return;
    }
    this.notes.delete(oldPath);
    this.notes.set(newPath, content);
    this.renamed.push({ oldPath, newPath });
  }

  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }

  override async trashNote(path: string): Promise<void> {
    this.notes.delete(path);
    this.trashed.push(path);
  }

  override async readTask(handle: string): Promise<CanonicalTask | null> {
    const content = this.notes.get(handle);
    if (content === undefined) {
      return null;
    }
    const note = parseTaskNote(content, handle);
    if (typeFromLabels(note.labels) === '') {
      return null;
    }
    return new CanonicalTask({
      handle,
      entityId: handle,
      title: note.title,
      body: note.body,
      status: note.status,
      completed: note.completed,
      parent: note.parent,
      labels: note.labels,
    });
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

function todoContent(
  parentLink: string,
  status: 'open' | 'completed' = 'open',
): string {
  return [
    '---',
    'categories: [taken]',
    'labels: [type:todo]',
    `status: ${status}`,
    'completed:',
    `affiliation: ["[[_Acme Widgets]]", "[[${parentLink}]]"]`,
    `synced: ${syncedAt}`,
    '---',
    '',
  ].join('\n');
}

function openTodo(): string {
  return todoContent(taskLink);
}

function capturedTodo(url: string): string {
  return [
    '---',
    'categories: [taken]',
    'labels: [type:todo]',
    'status: open',
    'completed:',
    `url: ${url}`,
    `affiliation: ["[[_Acme Widgets]]", "[[${taskLink}]]"]`,
    `synced: ${syncedAt}`,
    '---',
    '',
  ].join('\n');
}

let vault: FakeVault;
let action: SyncChecklistAction;

beforeEach(() => {
  vault = new FakeVault();
  action = new SyncChecklistAction(vault, 'Templates/Task.md');
});

describe('TDO-1 — a rendered ToDo lives under taken/ carrying a type:todo label', () => {
  it('renders the promoted ToDo under taken/ with type:todo, and the tracked read returns it', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.notes.has(todoPath)).toBe(true);
    expect(vault.notes.get(todoPath)).toMatch(/^labels:.*type:todo/m);
    expect(await vault.readTask(todoPath)).not.toBeNull();
    expect((await vault.readTask(todoPath))?.labels).toContain('type:todo');
  });
});

describe('TDO-3 — an unlinked checklist line promotes a ToDo under taken/', () => {
  it('creates the ToDo under taken/, carrying type:todo, and links the line', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([todoPath]);
    expect(vault.notes.get(todoPath)).toMatch(/^labels:.*type:todo/m);
    expect(vault.notes.get(todoPath)).not.toContain('Todos.base');
    expect(ToDoNoteParser.parse(vault.notes.get(todoPath)!)).toMatchObject({
      status: 'open',
      affiliation: ['[[_Acme Widgets]]', '[[42-fix-the-bug]]'],
    });
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
    expect(vault.written.map((entry) => entry.path)).toEqual([taskPath]);
  });

  it('stamps the created ToDo with its own id', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(noteId(vault.notes.get(todoPath) ?? '')).toBeTruthy();
  });

  it('suffixes the slug until the taken/ path is free', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));
    vault.notes.set(todoPath, 'already here');

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([
      'Projecten/Acme Widgets/taken/fix-the-bug-2.md',
    ]);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      '- [ ] [[Projecten/Acme Widgets/taken/fix-the-bug-2.md|Fix the bug]]',
    );
  });

  it('renders the ToDo through the task template', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] Fix the bug'));
    const template = [
      '---',
      'affiliation: []',
      'labels:',
      'status:',
      'created: {{date}}',
      '---',
    ].join('\n');
    vault.notes.set('Templates/Task.md', template);

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([todoPath]);
    expect(vault.notes.get(todoPath)).toContain('created: 2026-09-18');
    expect(vault.notes.get(todoPath)).toMatch(/^labels:.*type:todo/m);
  });
});

describe('TDO-3 — checklist state mirrors to the ToDo', () => {
  it('marks a checked item completed with the sync stamp', async () => {
    vault.notes.set(taskPath, taskNote(`- [x] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, openTodo());

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    const parsed = ToDoNoteParser.parse(vault.notes.get(todoPath)!);
    expect(parsed?.status).toBe('open');
    expect(parsed?.completed).toBe(syncedAt);
    expect(vault.written.map((entry) => entry.path)).toEqual([todoPath]);
  });

  it('clears a completed ToDo completion when its item is unchecked, leaving its status untouched', async () => {
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(
      todoPath,
      [
        '---',
        'categories: [taken]',
        'labels: [type:todo]',
        'status: completed',
        'completed: 2026-09-01T09:00:00Z',
        `affiliation: ["[[_Acme Widgets]]", "[[${taskLink}]]"]`,
        `synced: ${syncedAt}`,
        '---',
        '',
      ].join('\n'),
    );

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    const parsed = ToDoNoteParser.parse(vault.notes.get(todoPath)!);
    expect(parsed?.status).toBe('completed');
    expect(parsed?.completed).toBeNull();
  });

  it('re-creates a ToDo at taken/ when the line links to a missing note', async () => {
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([todoPath]);
    expect(ToDoNoteParser.parse(vault.notes.get(todoPath)!)?.status).toBe(
      'open',
    );
    expect(vault.written).toEqual([]);
  });

  it('relinks a bare link to the existing ToDo under taken/', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] [[fix-the-bug|Fix the bug]]'));
    vault.notes.set(todoPath, openTodo());

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created).toEqual([]);
    expect(vault.trashed).toEqual([]);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });

  it('re-promotes a bare link with no matching ToDo at the taken/ path', async () => {
    vault.notes.set(taskPath, taskNote('- [ ] [[fix-the-bug|Fix the bug]]'));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([todoPath]);
    expect(vault.notes.has('fix-the-bug')).toBe(false);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });

  it('never creates a ToDo outside taken/ for a malformed link', async () => {
    vault.notes.set(
      taskPath,
      taskNote('- [ ] [[notes/fix-the-bug|Fix the bug]]'),
    );

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.created.map((entry) => entry.path)).toEqual([todoPath]);
    expect(vault.notes.has('notes/fix-the-bug')).toBe(false);
  });

  it('renames the ToDo when the item text drifts from its filename', async () => {
    const stalePath = 'Projecten/Acme Widgets/taken/fi.md';
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

  it('leaves an already-correct ToDo alone, suffix tolerated', async () => {
    const cases = [
      {
        name: 'exact slug',
        path: todoPath,
        line: todoPath,
        title: 'Fix the bug',
      },
      {
        name: 'collision suffix',
        path: 'Projecten/Acme Widgets/taken/test-2.md',
        line: 'Projecten/Acme Widgets/taken/test-2.md',
        title: 'test',
      },
    ];
    for (const { name, path, line, title } of cases) {
      const local = new FakeVault();
      const localAction = new SyncChecklistAction(local, 'Templates/Task.md');
      local.notes.set(taskPath, taskNote(`- [ ] [[${line}|${title}]]`));
      local.notes.set(path, todoContent(taskLink));

      await localAction.execute({ notePath: taskPath, projectName, syncedAt });

      expect(local.renamed, name).toEqual([]);
      expect(local.written, name).toEqual([]);
    }
  });

  it('suffixes the rename target when the slug is already taken', async () => {
    const stalePath = 'Projecten/Acme Widgets/taken/fi.md';
    vault.notes.set(taskPath, taskNote(`- [ ] [[${stalePath}|Fix the bug]]`));
    vault.notes.set(stalePath, openTodo());
    vault.notes.set(todoPath, 'already here');

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    const suffixed = 'Projecten/Acme Widgets/taken/fix-the-bug-2.md';
    expect(vault.renamed).toEqual([{ oldPath: stalePath, newPath: suffixed }]);
    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${suffixed}|Fix the bug]]`,
    );
  });

  it('rewrites the parent body once when promotion and drift both change links', async () => {
    const stalePath = 'Projecten/Acme Widgets/taken/fi.md';
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
        '- [ ] [[Projecten/Acme Widgets/taken/new-item.md|New item]]',
        `- [ ] [[${todoPath}|Fix the bug]]`,
      ].join('\n'),
    );
  });
});

describe('TDO-4 — removing a checklist line trashes its ToDo (the delete reconciles via NWM-25/NWM-27)', () => {
  it('trashes the ToDo when its checklist line is gone', async () => {
    vault.notes.set(taskPath, taskNote('No items left.'));
    vault.notes.set(todoPath, openTodo());

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.trashed).toEqual([todoPath]);
    expect(vault.notes.has(todoPath)).toBe(false);
  });

  it('trashes a captured or materialised ToDo too — the removal is not suppressed', async () => {
    vault.notes.set(taskPath, taskNote('No items left.'));
    const capturedPath = 'Projecten/Acme Widgets/taken/captured.md';
    vault.notes.set(capturedPath, capturedTodo('https://todoist.com/tasks/9'));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.trashed).toEqual([capturedPath]);
    expect(vault.notes.has(capturedPath)).toBe(false);
  });

  it('never removes a regular task note in taken/', async () => {
    vault.notes.set(taskPath, taskNote('No items left.'));
    const childPath = 'Projecten/Acme Widgets/taken/42-child.md';
    vault.notes.set(childPath, taskNote('- [ ] nothing'));

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.trashed).toEqual([]);
    expect(vault.notes.has(childPath)).toBe(true);
  });
});

describe('SYNC-8 — a settled checklist pass writes nothing', () => {
  it('performs zero writes on a second pass across every settle path', async () => {
    const stalePath = 'Projecten/Acme Widgets/taken/fi.md';
    const missingLink =
      'Projecten/Acme Widgets/taken/promotion-end-to-end-from-obsidian';
    const missingTitle = 'Promotion end to end from obsidian';
    const realPath =
      'Projecten/Acme Widgets/taken/promotion-end-to-end-from-obsidian.md';
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
        name: 'missing-link relink',
        prepare: (v) => {
          v.notes.set(
            taskPath,
            taskNote(`- [ ] [[${missingLink}|${missingTitle}]]`),
          );
          v.notes.set(realPath, todoContent(taskLink));
        },
        expectedCreated: 0,
        expectedWritten: 1,
      },
    ];

    for (const { name, prepare, expectedCreated, expectedWritten } of rows) {
      const local = new FakeVault();
      const localAction = new SyncChecklistAction(local, 'Templates/Task.md');
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
