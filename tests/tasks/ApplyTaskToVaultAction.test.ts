import { describe, expect, it } from 'vitest';
import { ApplyTaskToVaultAction } from '../../src/tasks/ApplyTaskToVaultAction.js';
import { CompleteTaskCascadeAction } from '../../src/tasks/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../src/tasks/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../src/vault/TaskNoteMapper.js';
import { ToDoNoteMapper } from '../../src/vault/ToDoNoteMapper.js';
import { hash } from '../../src/shared/hash.js';
import type { TaskData } from '../../src/shared/TaskData.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  written: Array<{ path: string; content: string }> = [];
  renamed: Array<{ oldPath: string; newPath: string }> = [];

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
    if (content !== undefined) {
      this.notes.delete(oldPath);
      this.notes.set(newPath, content);
    }
    this.renamed.push({ oldPath, newPath });
  }
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
const projectName = 'Acme Widgets';
const syncedAt = '2026-09-18T12:00:00Z';

function task(overrides: Partial<TaskData> = {}): TaskData {
  return taskData({
    id: 'uuid-42',
    notePath,
    mirrors: { github: url },
    title: 'Fix the bug',
    body: 'The bug happens on resize.',
    status: 'Building',
    type: 'task',
    ...overrides,
  });
}

function noteFor(t: TaskData): string {
  return TaskNoteMapper.map(
    {
      type: t.type,
      title: t.title,
      body: t.body,
      createdAt: t.createdAt,
    },
    { projectName, syncedAt, statusName: t.status },
  ).content;
}

function makeAction(vault: FakeVault, syncState: FakeSyncState) {
  const createTaskNote = new CreateTaskNoteAction(vault, syncState, '');
  const completeTaskCascade = new CompleteTaskCascadeAction(vault, 'Shipped');
  return new ApplyTaskToVaultAction(
    vault,
    syncState,
    createTaskNote,
    '',
    completeTaskCascade,
  );
}

function seedRecord(
  syncState: FakeSyncState,
  base: TaskData | null = null,
): void {
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: { handle: url, base },
  });
}

describe('SYNC-2 — a remote change flows into the vault', () => {
  it('creates a note for an untracked issue and anchors its record', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = makeAction(vault, syncState);

    await action.execute({
      task: task(),
      current: null,
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    expect(vault.created).toHaveLength(1);
    const created = vault.created[0]!;
    expect(created.path).toBe(notePath);
    const record = await syncState.findByMirror('github', url);
    expect(record?.notePath).toBe(notePath);
    expect(syncState.baseOf(record!.id, 'github')?.body).toBe(
      hash(task().body),
    );
  });

  it('renames the note when the title changed', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    seedRecord(syncState);
    vault.notes.set(notePath, noteFor(task()));
    const action = makeAction(vault, syncState);
    const retitled = task({ title: 'Fix the widget' });

    await action.execute({
      task: retitled,
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    const newPath = 'Projecten/Acme Widgets/taken/fix-the-widget.md';
    expect(vault.renamed).toEqual([{ oldPath: notePath, newPath }]);
    expect((await syncState.get('uuid-42'))?.notePath).toBe(newPath);
  });

  it('rewrites the note body and status when they differ', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    seedRecord(syncState);
    vault.notes.set(notePath, noteFor(task()));
    const action = makeAction(vault, syncState);
    const changed = task({ body: 'The bug now also happens on resize.' });

    await action.execute({
      task: changed,
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    expect(vault.written).toEqual([
      { path: notePath, content: noteFor(changed) },
    ]);
  });

  it('rewrites a task note without introducing a todoist anchor', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    seedRecord(syncState);
    vault.notes.set(notePath, noteFor(task()));
    const action = makeAction(vault, syncState);
    const changed = task({ body: 'The bug now also happens on resize.' });

    await action.execute({
      task: changed,
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).not.toContain('todoist:');
  });

  it('skips the write when the note already matches', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    seedRecord(syncState);
    vault.notes.set(notePath, noteFor(task()));
    const action = makeAction(vault, syncState);

    await action.execute({
      task: task(),
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'push',
    });

    expect(vault.written).toEqual([]);
    expect(vault.renamed).toEqual([]);
  });

  it('rewrites the note through the template on a remote change', async () => {
    const vault = new FakeVault();
    const template = [
      '---',
      'affiliation: []',
      'id:',
      'type:',
      'status:',
      'synced:',
      'created: {{date}}',
      'categories:',
      '  - "[[Tasks.base|Tasks]]"',
      'tags: []',
      '---',
    ].join('\n');
    vault.notes.set('Templates/Task.md', template);
    const syncState = new FakeSyncState();
    seedRecord(syncState);
    vault.notes.set(notePath, noteFor(task()));
    const createTaskNote = new CreateTaskNoteAction(
      vault,
      syncState,
      'Templates/Task.md',
    );
    const action = new ApplyTaskToVaultAction(
      vault,
      syncState,
      createTaskNote,
      'Templates/Task.md',
      new CompleteTaskCascadeAction(vault, 'Shipped'),
    );
    const changed = task({ body: 'The bug now also happens on resize.' });

    await action.execute({
      task: changed,
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    const expected = TaskNoteMapper.render(
      template,
      {
        type: changed.type,
        title: changed.title,
        body: changed.body,
        createdAt: null,
      },
      { projectName, syncedAt, statusName: changed.status },
    ).content;
    expect(vault.written).toEqual([{ path: notePath, content: expected }]);
  });

  it('leaves unknown checklist items unlinked', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    seedRecord(syncState);
    vault.notes.set(notePath, noteFor(task()));
    vault.notes.set(
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
      ToDoNoteMapper.map(
        {
          title: 'Fix the bug',
          projectName,
          taskLink: 'fix-the-bug',
        },
        { syncedAt, statusName: 'open' },
      ).content,
    );
    const action = makeAction(vault, syncState);
    const changed = task({
      body: ['- [ ] New item', '- [x] Fix the bug'].join('\n'),
    });

    await action.execute({
      task: changed,
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    const linkedBody = [
      '- [ ] New item',
      '- [x] [[Projecten/Acme Widgets/todos/fix-the-bug.md|Fix the bug]]',
    ].join('\n');
    expect(vault.written).toEqual([
      {
        path: notePath,
        content: noteFor(taskData({ ...changed, body: linkedBody })),
      },
    ]);
  });

  it('cascades a done status onto the checklist line and its to-dos', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    seedRecord(syncState);
    vault.notes.set(notePath, noteFor(task()));
    const todoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
    vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(
        {
          title: 'Fix the bug',
          projectName,
          taskLink: 'fix-the-bug',
        },
        { syncedAt, statusName: 'open' },
      ).content,
    );
    const action = makeAction(vault, syncState);
    const done = task({
      status: 'Shipped',
      completedAt: syncedAt,
      body: '- [ ] Fix the bug',
    });

    await action.execute({
      task: done,
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    expect(vault.notes.get(notePath)).toContain(
      `- [x] [[${todoPath}|Fix the bug]]`,
    );
    expect(vault.notes.get(todoPath)).toContain('status: completed');
  });

  it('leaves an open status alone (reopen does not reopen to-dos)', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    seedRecord(syncState);
    vault.notes.set(notePath, noteFor(task()));
    const todoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
    vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(
        {
          title: 'Fix the bug',
          projectName,
          taskLink: 'fix-the-bug',
        },
        { syncedAt, statusName: 'completed', completedAt: syncedAt },
      ).content,
    );
    const action = makeAction(vault, syncState);

    await action.execute({
      task: task({ body: '- [x] Fix the bug' }),
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    expect(vault.notes.get(todoPath)).toContain('status: completed');
  });

  it('resolves an affiliation parent to its hub uuid on the applied base', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const slicePath = 'Projecten/Acme Widgets/taken/the-slice.md';
    syncState.seed(entityRecord({ id: 'slice-uuid', notePath: slicePath }));
    seedRecord(syncState);
    const content = noteFor(task()).replace(
      'affiliation: ["[[_Acme Widgets]]"]',
      'affiliation: ["[[_Acme Widgets]]", "[[the-slice]]"]',
    );
    vault.notes.set(notePath, content);
    const action = makeAction(vault, syncState);
    const changed = task({ body: 'The bug now also happens on resize.' });

    await action.execute({
      task: changed,
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    expect(syncState.baseOf('uuid-42', 'github')?.parent).toBe('slice-uuid');
  });

  it('updates the note affiliation when a pull changes the parent', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const parentPath = 'Projecten/Acme Widgets/taken/the-slice.md';
    syncState.seed(entityRecord({ id: 'slice-uuid', notePath: parentPath }));
    seedRecord(syncState);
    vault.notes.set(notePath, noteFor(task()));
    const action = makeAction(vault, syncState);

    await action.execute({
      task: task({ parent: 'slice-uuid' }),
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[the-slice]]"]',
    );
    expect(syncState.baseOf('uuid-42', 'github')?.parent).toBe('slice-uuid');
  });

  it('advances mirrors.github.base only on a pull', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const oldBase = taskData({
      id: 'uuid-42',
      notePath,
      title: 'Fix the bug',
      body: hash('old body'),
      status: 'Building',
    });
    seedRecord(syncState, oldBase);
    vault.notes.set(notePath, noteFor(task()));
    const action = makeAction(vault, syncState);
    const changed = task({ body: 'The bug now also happens on resize.' });

    await action.execute({
      task: changed,
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'pull',
    });

    expect(syncState.baseOf('uuid-42', 'github')?.body).toBe(
      hash(changed.body),
    );
    expect(vault.written).toHaveLength(1);
  });

  it('leaves mirrors.github.base to the GitHub writer on a push', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const oldBase = taskData({
      id: 'uuid-42',
      notePath,
      title: 'Fix the bug',
      body: hash('old body'),
      status: 'Building',
    });
    seedRecord(syncState, oldBase);
    vault.notes.set(notePath, noteFor(task()));
    const action = makeAction(vault, syncState);
    const before = syncState.baseOf('uuid-42', 'github');

    await action.execute({
      task: task({ body: 'A vault-side edit.' }),
      current: task(),
      projectName,
      connectionSlug: 'github',
      syncedAt,
      origin: 'push',
    });

    const after = syncState.baseOf('uuid-42', 'github');
    expect(after).toBe(before);
  });
});
