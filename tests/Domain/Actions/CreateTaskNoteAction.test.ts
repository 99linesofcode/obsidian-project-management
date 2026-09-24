import { describe, expect, it } from 'vitest';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';

// Fakes at the ports: record what the action asked for, so the action's own
// behaviour (create + record, or no-op) is what's under test.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  async writeNote(): Promise<void> {
    throw new Error('not used in this test');
  }

  async moveFolder(): Promise<void> {}
  async renameNote(): Promise<void> {
    throw new Error('not used in this test');
  }

  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }

  async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  onNoteChanged(): void {
    throw new Error('not used in this test');
  }

  onNoteDeleted(): void {
    throw new Error('not used in this test');
  }
  onNoteRenamed(): void {}
}

class FakeSyncState implements SyncStatePort {
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }

  async setLastProjectUpdate(): Promise<void> {}
  async getArchiveBaseline(): Promise<null> {
    return null;
  }
  async getWatchState(): Promise<{
    etag: string | null;
    cursor: string | null;
  }> {
    return { etag: null, cursor: null };
  }

  async setWatchState(): Promise<void> {}

  async getTodoistProjectState(): Promise<null> {
    return null;
  }
  async setTodoistProjectState(): Promise<void> {}

  async setArchiveBaseline(): Promise<void> {}
  stored: Status[] = [];

  async get(): Promise<Status | null> {
    return null;
  }

  async set(status: Status): Promise<void> {
    this.stored.push(status);
  }

  async findByNotePath(): Promise<Status | null> {
    return null;
  }

  async remove(): Promise<void> {
    throw new Error('not used in this test');
  }

  async setIdentity(): Promise<void> {
    throw new Error('not used in this test');
  }

  async getIdentity(): Promise<null> {
    return null;
  }

  async list(): Promise<Status[]> {
    return [];
  }
}

const task: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: [],
};

const templatePath = 'Templates/Task.md';

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

describe('CreateTaskNoteAction', () => {
  it('creates the note and writes the status record', async () => {
    // Given — a vault with no existing note and an empty sync state
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    // When — the action materialises the task note
    await action.execute({
      task,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
      statusName: 'Building',
    });

    // Then — the note is created at the mapped path with the mapped content
    const { path, content } = TaskNoteMapper.map(task, {
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
      statusName: 'Building',
    });
    expect(vault.created).toEqual([{ path, content }]);
    // And the status record is written with the body hash and remote updatedAt
    expect(syncState.stored).toEqual([
      {
        url: task.url,
        remoteId: task.remoteId,
        notePath: path,
        lastSyncedBodyHash: hash(task.body),
        lastSyncedRemoteUpdatedAt: task.updatedAt,
        lastSyncedStatus: 'Building',
        lastSyncedTitle: task.title,
      },
    ]);
  });

  it('renders the note from the vault template', async () => {
    // Given — a vault holding the task template
    const vault = new FakeVault();
    vault.notes.set(templatePath, template);
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    // When — the action materialises the task note
    await action.execute({
      task,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
      statusName: 'Building',
    });

    // Then — the note content is the rendered template
    const { path, content } = TaskNoteMapper.render(template, task, {
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
      statusName: 'Building',
    });
    expect(vault.created).toEqual([{ path, content }]);
  });

  it('falls back to the built-in frontmatter when the template is missing', async () => {
    // Given — a vault without the template note
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    // When — the action materialises the task note
    await action.execute({
      task,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
      statusName: 'Building',
    });

    // Then — the note content is the built-in mapping
    const { path, content } = TaskNoteMapper.map(task, {
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
      statusName: 'Building',
    });
    expect(vault.created).toEqual([{ path, content }]);
  });

  it('is a no-op when the note already exists', async () => {
    // Given — a vault that already holds the note
    const vault = new FakeVault();
    const { path } = TaskNoteMapper.map(task, {
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
      statusName: 'Building',
    });
    vault.notes.set(path, 'already there');
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    // When — the action runs
    await action.execute({
      task,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
      statusName: 'Building',
    });

    // Then — nothing is created and no status record is written
    expect(vault.created).toEqual([]);
    expect(syncState.stored).toEqual([]);
  });
});
