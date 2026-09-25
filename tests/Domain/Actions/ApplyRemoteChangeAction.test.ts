import { describe, expect, it } from 'vitest';
import { ApplyRemoteChangeAction } from '../../../src/Domain/Actions/ApplyRemoteChangeAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';

// Fakes at the ports: hold notes and status records in memory and record the
// operations the action performs, so the action's own behaviour is under test.
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

  async moveFolder(): Promise<void> {}
  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = this.notes.get(oldPath);
    if (content !== undefined) {
      this.notes.delete(oldPath);
      this.notes.set(newPath, content);
    }
    this.renamed.push({ oldPath, newPath });
  }

  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
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
  async getTodoistState(): Promise<null> {
    return null;
  }
  async setTodoistState(): Promise<void> {}
  async listTodoistStates(): Promise<[]> {
    return [];
  }
  async removeTodoistState(): Promise<void> {}

  async setArchiveBaseline(): Promise<void> {}
  statuses = new Map<string, Status>();
  setCalls: Status[] = [];
  identity: ProjectIdentityData | null = null;

  async get(url: string): Promise<Status | null> {
    return this.statuses.get(url) ?? null;
  }

  async set(status: Status): Promise<void> {
    this.statuses.set(status.url, status);
    this.setCalls.push(status);
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

  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }

  async list(): Promise<Status[]> {
    return [];
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  boardStatusCalls: Array<{ issueUrl: string; statusOptionId: string }> = [];

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchTask(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async setTaskState(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setBoardStatus(
    _projectNodeId: string,
    _statusFieldId: string,
    issueUrl: string,
    statusOptionId: string,
  ): Promise<void> {
    this.boardStatusCalls.push({ issueUrl, statusOptionId });
  }
  async addBoardItem(): Promise<void> {
    throw new Error('not used in this test');
  }

  async fetchUnpromotedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }

  async addLabel(): Promise<void> {
    throw new Error('not used in this test');
  }

  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }

  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const task: GithubTaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: ['type: task'],
};

const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'Building',
};

function makeStatus(overrides: Partial<Status> = {}): Status {
  const { path } = TaskNoteMapper.map(task, context);
  return {
    url: task.url,
    remoteId: task.remoteId,
    notePath: path,
    lastSyncedBodyHash: hash(task.body),
    lastSyncedRemoteUpdatedAt: task.updatedAt,
    lastSyncedStatus: 'Building',
    lastSyncedTitle: task.title,
    ...overrides,
  };
}

function makeAction(
  vault: FakeVault,
  syncState: FakeSyncState,
  projectManagement: FakeProjectManagement,
) {
  const createTaskNote = new CreateTaskNoteAction(
    vault,
    syncState,
    'Templates/Task.md',
  );
  const boardStatus = new BoardStatusAction(syncState, projectManagement);
  return new ApplyRemoteChangeAction(
    vault,
    syncState,
    createTaskNote,
    boardStatus,
    'Templates/Task.md',
  );
}

describe('ApplyRemoteChangeAction', () => {
  it('updates the note body and status when the remote changed', async () => {
    // Given — a synced note whose remote body has since changed
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState, new FakeProjectManagement());
    const changed: GithubTaskData = {
      ...task,
      body: 'The bug now also happens on resize.',
      updatedAt: '2026-09-18T11:00:00Z',
    };

    // When — the remote change is applied
    await action.execute({ task: changed, ...context });

    // Then — the note is rewritten with the new body
    const { content: newContent } = TaskNoteMapper.map(changed, context);
    expect(vault.written).toEqual([{ path, content: newContent }]);
    // And the status record is updated with the new hash and updatedAt
    expect(syncState.setCalls).toEqual([
      {
        url: task.url,
        remoteId: task.remoteId,
        notePath: path,
        lastSyncedBodyHash: hash(changed.body),
        lastSyncedRemoteUpdatedAt: changed.updatedAt,
        lastSyncedStatus: 'Building',
        lastSyncedTitle: changed.title,
      },
    ]);
  });

  it('renames the note and updates notePath when the title changed', async () => {
    // Given — a synced note whose remote title has since changed
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState, new FakeProjectManagement());
    const retitled: GithubTaskData = { ...task, title: 'Fix the Widget!' };

    // When — the remote change is applied
    await action.execute({ task: retitled, ...context });

    // Then — the note is renamed to the new mapped path
    const { path: newPath } = TaskNoteMapper.map(retitled, context);
    expect(vault.renamed).toEqual([{ oldPath: path, newPath }]);
    // And the status record's notePath follows the rename
    expect(syncState.setCalls[0]!.notePath).toBe(newPath);
  });

  it('skips silently when nothing changed', async () => {
    // Given — a synced note whose remote is unchanged
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState, new FakeProjectManagement());

    // When — the unchanged remote change is applied
    await action.execute({ task, ...context });

    // Then — nothing is written, renamed or re-recorded
    expect(vault.written).toEqual([]);
    expect(vault.renamed).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });

  it('materialises a note when no status record exists', async () => {
    // Given — a task with no status record (a newly promoted issue)
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = makeAction(vault, syncState, new FakeProjectManagement());

    // When — the remote change is applied
    await action.execute({ task, ...context });

    // Then — the note is created via the create action
    const { path, content } = TaskNoteMapper.map(task, context);
    expect(vault.created).toEqual([{ path, content }]);
    // And a status record is written
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.notePath).toBe(path);
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
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
    vault.notes.set(path, content);
    const action = makeAction(vault, syncState, new FakeProjectManagement());
    const changed: GithubTaskData = {
      ...task,
      body: 'The bug now also happens on resize.',
      updatedAt: '2026-09-18T11:00:00Z',
    };

    // When — the remote change is applied
    await action.execute({ task: changed, ...context });

    // Then — the note is rewritten with the rendered template content
    const { content: newContent } = TaskNoteMapper.render(
      template,
      changed,
      context,
    );
    expect(vault.written).toEqual([{ path, content: newContent }]);
  });

  it('mirrors a remote status flip onto the board', async () => {
    // Given — a synced open note whose remote status has since closed
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
    vault.notes.set(path, content);
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);
    const closed: GithubTaskData = {
      ...task,
      state: 'closed',
      updatedAt: '2026-09-18T11:00:00Z',
    };
    syncState.identity = {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Unshaped' },
        { id: 'PVTSSF_3', name: 'Done' },
      ],
    };

    // When — the remote change is applied
    await action.execute({ task: closed, ...context, statusName: 'Done' });

    // Then — the board Status is mirrored to the done option
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: task.url, statusOptionId: 'PVTSSF_3' },
    ]);
  });

  it('re-links checklist items when the remote body changes', async () => {
    // Given — a synced note and a to-do note for the item the remote added
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
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
    const action = makeAction(vault, syncState, new FakeProjectManagement());
    const changed: GithubTaskData = {
      ...task,
      body: '- [ ] Fix the bug',
      updatedAt: '2026-09-18T11:00:00Z',
    };

    // When — the remote change is applied
    await action.execute({ task: changed, ...context });

    // Then — the note body carries the to-do link
    const linkedBody =
      '- [ ] [[Projecten/Acme Widgets/todos/fix-the-bug.md|Fix the bug]]';
    const { content: newContent } = TaskNoteMapper.map(
      { ...changed, body: linkedBody },
      context,
    );
    expect(vault.written).toEqual([{ path, content: newContent }]);
    // And the baseline still hashes the raw remote body
    expect(syncState.setCalls[0]!.lastSyncedBodyHash).toBe(hash(changed.body));
  });

  it('re-links surviving items and leaves unknown ones unlinked', async () => {
    // Given — a synced note and a to-do for one of two remote checklist items
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const status = makeStatus();
    syncState.statuses.set(task.url, status);
    const { path, content } = TaskNoteMapper.map(task, context);
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
    const action = makeAction(vault, syncState, new FakeProjectManagement());
    const changed: GithubTaskData = {
      ...task,
      body: ['- [ ] New item', '- [x] Fix the bug'].join('\n'),
      updatedAt: '2026-09-18T11:00:00Z',
    };

    // When — the remote change is applied
    await action.execute({ task: changed, ...context });

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
});
