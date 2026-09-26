import { describe, expect, it } from 'vitest';
import { ApplyTaskToVaultAction } from '../../../src/Domain/Actions/ApplyTaskToVaultAction.js';
import { CompleteTaskCascadeAction } from '../../../src/Domain/Actions/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: hold notes and records in memory and record the writes,
// so the writer's field-level gates are what's under test.
class FakeVault implements VaultPort {
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

class FakeSyncState implements SyncStatePort {
  statuses = new Map<string, TaskData>();
  setCalls: TaskData[] = [];

  async get(url: string): Promise<TaskData | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: TaskData): Promise<void> {
    this.statuses.set(status.url, status);
    this.setCalls.push(status);
  }
  async findByNotePath(): Promise<TaskData | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<TaskData[]> {
    return [...this.statuses.values()];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<null> {
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
  async getTodoistProjectState(): Promise<null> {
    return null;
  }
  async setTodoistProjectState(): Promise<void> {}
  async getTodoistState(): Promise<null> {
    return null;
  }
  async setTodoistState(): Promise<void> {}
  async removeTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<[]> {
    return [];
  }
}

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'Building',
};

function task(overrides: Partial<TaskData> = {}): TaskData {
  return {
    url,
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    todoistId: '',
    notePath,
    title: 'Fix the bug',
    body: 'The bug happens on resize.',
    status: 'Building',
    completed: false,
    parent: null,
    labels: ['type: task'],
    updatedAt: '2026-09-18T10:00:00Z',
    ...overrides,
  };
}

function makeAction(vault: FakeVault, syncState: FakeSyncState) {
  const createTaskNote = new CreateTaskNoteAction(
    vault,
    syncState,
    'Templates/Task.md',
  );
  const completeTaskCascade = new CompleteTaskCascadeAction(vault, 'Shipped');
  return new ApplyTaskToVaultAction(
    vault,
    syncState,
    createTaskNote,
    'Templates/Task.md',
    completeTaskCascade,
  );
}

describe('ApplyTaskToVaultAction', () => {
  it('creates a note for an untracked issue', async () => {
    // Given — a winning remote task with no note yet
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = makeAction(vault, syncState);

    // When — the winning task is rendered onto the vault
    await action.execute({
      task: task(),
      current: null,
      projectName: 'Acme Widgets',
      syncedAt: context.syncedAt,
    });

    // Then — the note is created at the mapped path
    const { path, content } = TaskNoteMapper.map(task(), context);
    expect(vault.created).toEqual([{ path, content }]);
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.notePath).toBe(path);
  });

  it('renames the note when the title changed', async () => {
    // Given — a synced note whose remote title moved
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const { path, content } = TaskNoteMapper.map(task(), context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState);
    const retitled = task({ title: 'Fix the widget' });

    // When — the winning task is rendered
    await action.execute({
      task: retitled,
      current: task(),
      projectName: 'Acme Widgets',
      syncedAt: context.syncedAt,
    });

    // Then — the note is renamed to the new mapped path
    const { path: newPath } = TaskNoteMapper.map(retitled, context);
    expect(vault.renamed).toEqual([{ oldPath: path, newPath }]);
    expect(syncState.setCalls[0]!.notePath).toBe(newPath);
  });

  it('rewrites the note body and status when they differ', async () => {
    // Given — a synced note whose remote body moved
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const { path, content } = TaskNoteMapper.map(task(), context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState);
    const changed = task({ body: 'The bug now also happens on resize.' });

    // When — the winning task is rendered
    await action.execute({
      task: changed,
      current: task(),
      projectName: 'Acme Widgets',
      syncedAt: context.syncedAt,
    });

    // Then — the note is rewritten with the new body
    const { content: newContent } = TaskNoteMapper.map(changed, context);
    expect(vault.written).toEqual([{ path, content: newContent }]);
    expect(syncState.setCalls[0]!.body).toBe(hash(changed.body));
  });

  it('skips the write when the note already matches', async () => {
    // Given — a synced note already in step with the remote
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const { path, content } = TaskNoteMapper.map(task(), context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState);

    // When — the unchanged winning task is rendered
    await action.execute({
      task: task(),
      current: task(),
      projectName: 'Acme Widgets',
      syncedAt: context.syncedAt,
    });

    // Then — nothing is written or renamed
    expect(vault.written).toEqual([]);
    expect(vault.renamed).toEqual([]);
  });

  it('rewrites the note through the template on a remote change', async () => {
    // Given — a synced note and a vault holding the task template
    const vault = new FakeVault();
    const template = [
      '---',
      'affiliation: []',
      'url:',
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
    const { path, content } = TaskNoteMapper.map(task(), context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState);
    const changed = task({ body: 'The bug now also happens on resize.' });

    // When — the winning task is rendered
    await action.execute({
      task: changed,
      current: task(),
      projectName: 'Acme Widgets',
      syncedAt: context.syncedAt,
    });

    // Then — the note is rewritten with the rendered template content
    const { content: newContent } = TaskNoteMapper.render(
      template,
      changed,
      context,
    );
    expect(vault.written).toEqual([{ path, content: newContent }]);
  });

  it('leaves unknown checklist items unlinked', async () => {
    // Given — a synced note and a to-do for only one of two remote items
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const { path, content } = TaskNoteMapper.map(task(), context);
    vault.notes.set(path, content);
    vault.notes.set(
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
      ToDoNoteMapper.map(
        {
          title: 'Fix the bug',
          projectName: 'Acme Widgets',
          taskLink: '42-fix-the-bug',
        },
        { syncedAt: context.syncedAt, statusName: 'open' },
      ).content,
    );
    const action = makeAction(vault, syncState);
    const changed = task({
      body: ['- [ ] New item', '- [x] Fix the bug'].join('\n'),
    });

    // When — the winning task is rendered
    await action.execute({
      task: changed,
      current: task(),
      projectName: 'Acme Widgets',
      syncedAt: context.syncedAt,
    });

    // Then — the known item is re-linked and the unknown one stays unlinked
    const linkedBody = [
      '- [ ] New item',
      '- [x] [[Projecten/Acme Widgets/todos/fix-the-bug.md|Fix the bug]]',
    ].join('\n');
    const { content: newContent } = TaskNoteMapper.map(
      { ...changed, body: linkedBody },
      context,
    );
    expect(vault.written).toEqual([{ path, content: newContent }]);
  });

  it('cascades a done status onto the checklist line and its to-dos', async () => {
    // Given — a synced task whose to-do is linked and still open
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const { path, content } = TaskNoteMapper.map(task(), context);
    vault.notes.set(path, content);
    const todoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
    vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(
        {
          title: 'Fix the bug',
          projectName: 'Acme Widgets',
          taskLink: '42-fix-the-bug',
        },
        { syncedAt: context.syncedAt, statusName: 'open' },
      ).content,
    );
    const action = makeAction(vault, syncState);
    const done = task({
      status: 'Shipped',
      completed: true,
      body: '- [ ] Fix the bug',
    });

    // When — the winning task applies the done status
    await action.execute({
      task: done,
      current: task(),
      projectName: 'Acme Widgets',
      syncedAt: context.syncedAt,
    });

    // Then — the line follows and the to-do completes (the dt-13 fan-out)
    expect(vault.notes.get(path)).toContain(
      `- [x] [[${todoPath}|Fix the bug]]`,
    );
    expect(vault.notes.get(todoPath)).toContain('status: completed');
  });

  it('leaves an open status alone (reopen does not reopen to-dos)', async () => {
    // Given — a task whose to-do is already completed
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const { path, content } = TaskNoteMapper.map(task(), context);
    vault.notes.set(path, content);
    const todoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
    vault.notes.set(
      todoPath,
      ToDoNoteMapper.map(
        {
          title: 'Fix the bug',
          projectName: 'Acme Widgets',
          taskLink: '42-fix-the-bug',
        },
        {
          syncedAt: context.syncedAt,
          statusName: 'completed',
          completedAt: context.syncedAt,
        },
      ).content,
    );
    const action = makeAction(vault, syncState);

    // When — an open (non-done) status applies
    await action.execute({
      task: task({ body: '- [x] Fix the bug' }),
      current: task(),
      projectName: 'Acme Widgets',
      syncedAt: context.syncedAt,
    });

    // Then — the completed to-do stays completed
    expect(vault.notes.get(todoPath)).toContain('status: completed');
  });
});
