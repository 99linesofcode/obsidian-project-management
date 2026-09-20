import { describe, expect, it } from 'vitest';
import { ReconcileTaskAction } from '../../../src/Domain/Actions/ReconcileTaskAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { ApplyRemoteChangeAction } from '../../../src/Domain/Actions/ApplyRemoteChangeAction.js';
import { PushNoteAction } from '../../../src/Domain/Actions/PushNoteAction.js';
import { PropagateStatusAction } from '../../../src/Domain/Actions/PropagateStatusAction.js';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import { VerdictResolver } from '../../../src/Domain/Reconciliation/VerdictResolver.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: hold notes and status records in memory and record the
// operations the composed actions perform, so the reconcile's own behaviour
// (read → verdict → push/apply/none) is what's under test.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  written: Array<{ path: string; content: string }> = [];
  renamed: Array<{ oldPath: string; newPath: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
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

  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  onNoteChanged(): void {
    throw new Error('not used in this test');
  }

  onNoteDeleted(): void {
    throw new Error('not used in this test');
  }
}

class FakeSyncState implements SyncStatePort {
  statuses = new Map<string, Status>();
  setCalls: Status[] = [];

  async get(url: string): Promise<Status | null> {
    return this.statuses.get(url) ?? null;
  }

  async set(status: Status): Promise<void> {
    this.statuses.set(status.url, status);
    this.setCalls.push(status);
  }

  async getLastPoll(): Promise<string | null> {
    return null;
  }

  async setLastPoll(): Promise<void> {
    throw new Error('not used in this test');
  }

  async setIdentity(): Promise<void> {
    throw new Error('not used in this test');
  }

  async getIdentity(): Promise<ProjectIdentityData | null> {
    return {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Todo' },
        { id: 'PVTSSF_2', name: 'In Progress' },
        { id: 'PVTSSF_3', name: 'Shipped' },
      ],
    };
  }

  async findByNotePath(): Promise<Status | null> {
    return null;
  }

  async remove(): Promise<void> {
    throw new Error('not used in this test');
  }

  async list(): Promise<Status[]> {
    return [];
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  remote: TaskData = task;
  updated: TaskData = task;
  updateCalls: Array<{ url: string; input: { title: string; body: string } }> =
    [];
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }

  async fetchChangedTasks(): Promise<TaskData[]> {
    return [];
  }

  async fetchTask(): Promise<TaskData> {
    return this.remote;
  }

  async updateTask(
    url: string,
    input: { title: string; body: string },
  ): Promise<TaskData> {
    this.updateCalls.push({ url, input });
    return this.updated;
  }

  async setTaskState(url: string, state: 'open' | 'closed'): Promise<TaskData> {
    this.stateCalls.push({ url, state });
    return this.updated;
  }

  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }

  boardStatusCalls: Array<{
    projectNodeId: string;
    statusFieldId: string;
    issueUrl: string;
    optionId: string;
  }> = [];

  async setBoardStatus(
    projectNodeId: string,
    statusFieldId: string,
    issueUrl: string,
    optionId: string,
  ): Promise<void> {
    this.boardStatusCalls.push({
      projectNodeId,
      statusFieldId,
      issueUrl,
      optionId,
    });
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

  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
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
  labels: ['type: task'],
};

const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'Todo',
};
const path = TaskNoteMapper.map(task, context).path;
const content = TaskNoteMapper.map(task, context).content;
const NEW_BODY = 'The bug now also happens on resize.';

function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    url: task.url,
    remoteId: task.remoteId,
    notePath: path,
    lastSyncedBodyHash: hash(task.body),
    lastSyncedRemoteUpdatedAt: task.updatedAt,
    lastSyncedStatus: 'Todo',
    lastSyncedTitle: task.title,
    ...overrides,
  };
}

function makeAction(
  vault: FakeVault,
  syncState: FakeSyncState,
  projectManagement: FakeProjectManagement,
) {
  const createTaskNote = new CreateTaskNoteAction(vault, syncState);
  const applyRemoteChange = new ApplyRemoteChangeAction(
    vault,
    syncState,
    createTaskNote,
    new BoardStatusAction(syncState, projectManagement),
  );
  const pushNote = new PushNoteAction(projectManagement);
  const propagateStatus = new PropagateStatusAction(
    projectManagement,
    syncState,
    new BoardStatusAction(syncState, projectManagement),
    'Shipped',
  );
  return new ReconcileTaskAction(
    vault,
    syncState,
    projectManagement,
    createTaskNote,
    applyRemoteChange,
    pushNote,
    propagateStatus,
    new VerdictResolver(),
    'Shipped',
  );
}

describe('ReconcileTaskAction', () => {
  it('pushes a note edit onto the issue and refreshes the full baseline', async () => {
    // Given — a synced note whose body the user has since edited, remote unchanged
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    vault.notes.set(
      path,
      TaskNoteMapper.map({ ...task, body: NEW_BODY }, context).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = {
      ...task,
      body: NEW_BODY,
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the note edit is reconciled
    await action.execute({ notePath: path, ...context });

    // Then — the issue is updated with the note's body (title unchanged)
    expect(projectManagement.updateCalls).toEqual([
      { url: task.url, input: { title: task.title, body: NEW_BODY } },
    ]);
    // And the baseline is refreshed from the PATCH response
    expect(syncState.setCalls).toEqual([
      {
        url: task.url,
        remoteId: task.remoteId,
        notePath: path,
        lastSyncedBodyHash: hash(NEW_BODY),
        lastSyncedRemoteUpdatedAt: '2026-09-18T12:30:00Z',
        lastSyncedStatus: 'Todo',
        lastSyncedTitle: task.title,
      },
    ]);
  });

  it('does not push when note, remote and baseline all agree (echo guard)', async () => {
    // Given — a synced note whose baseline is fresh and remote unchanged
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    vault.notes.set(path, content);
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the note edit is reconciled
    await action.execute({ notePath: path, ...context });

    // Then — nothing is pushed, applied or re-recorded
    expect(projectManagement.updateCalls).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(vault.renamed).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });

  it('pushes the slug-derived title when the note was renamed', async () => {
    // Given — a renamed note (new slug) whose body the user also edited
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    const newPath = 'Projecten/Acme Widgets/taken/42-fix-the-widget.md';
    vault.notes.set(
      newPath,
      TaskNoteMapper.map({ ...task, body: NEW_BODY }, context).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = {
      ...task,
      title: 'fix the widget',
      body: NEW_BODY,
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the renamed note edit is reconciled
    await action.execute({ notePath: newPath, ...context });

    // Then — the title derived from the new filename slug is pushed
    expect(projectManagement.updateCalls).toEqual([
      { url: task.url, input: { title: 'fix the widget', body: NEW_BODY } },
    ]);
  });

  it('does not push the title when the filename slug is unchanged', async () => {
    // Given — a note whose body changed but whose filename slug still matches
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    vault.notes.set(
      path,
      TaskNoteMapper.map({ ...task, body: NEW_BODY }, context).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = {
      ...task,
      body: NEW_BODY,
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the note edit is reconciled
    await action.execute({ notePath: path, ...context });

    // Then — the existing remote title is kept, only the body is pushed
    expect(projectManagement.updateCalls).toEqual([
      { url: task.url, input: { title: task.title, body: NEW_BODY } },
    ]);
  });

  it('pushes the note (Obsidian wins) and refreshes the baseline on conflict', async () => {
    // Given — both the note body and the remote changed since the last sync
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    vault.notes.set(
      path,
      TaskNoteMapper.map({ ...task, body: NEW_BODY }, context).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.remote = {
      ...task,
      body: 'Remote changed body.',
      updatedAt: '2026-09-18T11:00:00Z',
    };
    projectManagement.updated = {
      ...task,
      body: NEW_BODY,
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the conflicting note edit is reconciled
    await action.execute({ notePath: path, ...context });

    // Then — the note's body wins and is pushed
    expect(projectManagement.updateCalls).toEqual([
      { url: task.url, input: { title: task.title, body: NEW_BODY } },
    ]);
    // And the baseline is refreshed from the PATCH response
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.lastSyncedBodyHash).toBe(hash(NEW_BODY));
    expect(syncState.setCalls[0]!.lastSyncedRemoteUpdatedAt).toBe(
      '2026-09-18T12:30:00Z',
    );
  });

  it('applies the remote change when only the remote status changed', async () => {
    // Given — a note whose body is unchanged but whose remote status changed
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    vault.notes.set(path, content);
    const projectManagement = new FakeProjectManagement();
    projectManagement.remote = {
      ...task,
      state: 'closed',
      updatedAt: task.updatedAt,
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the note edit is reconciled
    await action.execute({ notePath: path, ...context });

    // Then — the remote change is applied (the note is rewritten with the new status)
    const { content: closedContent } = TaskNoteMapper.map(
        { ...task, state: 'closed' },
        { ...context, statusName: 'Shipped' },
      );
    expect(vault.written).toEqual([{ path, content: closedContent }]);
    // And the baseline mirrors the remote status
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.lastSyncedStatus).toBe('Shipped');
  });

  it('propagates a local status flip to the issue and refreshes the baseline', async () => {
    // Given — a note whose status the user flipped to done, remote unchanged
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    vault.notes.set(
      path,
      TaskNoteMapper.map({ ...task, state: 'closed' }, { ...context, statusName: 'Shipped' }).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = {
      ...task,
      state: 'closed',
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the note edit is reconciled
    await action.execute({ notePath: path, ...context });

    // Then — the issue is closed and the baseline is refreshed from the response
    expect(projectManagement.stateCalls).toEqual([
      { url: task.url, state: 'closed' },
    ]);
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.lastSyncedStatus).toBe('Shipped');
    expect(syncState.setCalls[0]!.lastSyncedRemoteUpdatedAt).toBe(
      '2026-09-18T12:30:00Z',
    );
  });

  it('lets the note win when both sides flipped the status differently', async () => {
    // Given — both the note and the remote changed status since the last sync
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    vault.notes.set(
      path,
      TaskNoteMapper.map({ ...task, state: 'closed' }, { ...context, statusName: 'Shipped' }).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.remote = {
      ...task,
      state: 'closed',
      updatedAt: task.updatedAt,
    };
    projectManagement.updated = {
      ...task,
      state: 'closed',
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the conflicting note edit is reconciled
    await action.execute({ notePath: path, ...context });

    // Then — the note's status is propagated to the remote and the baseline refreshed
    expect(projectManagement.stateCalls).toEqual([
      { url: task.url, state: 'closed' },
    ]);
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.lastSyncedStatus).toBe('Shipped');
  });

  it('mirrors the remote status onto the note without clobbering a pushed body', async () => {
    // Given — a note whose body the user edited while the remote status changed
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    vault.notes.set(
      path,
      TaskNoteMapper.map({ ...task, body: NEW_BODY }, context).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.remote = {
      ...task,
      state: 'closed',
      updatedAt: '2026-09-18T11:00:00Z',
    };
    projectManagement.updated = {
      ...task,
      body: NEW_BODY,
      state: 'closed',
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the note edit is reconciled
    await action.execute({ notePath: path, ...context });

    // Then — the pushed body is sent to the issue
    expect(projectManagement.updateCalls).toEqual([
      { url: task.url, input: { title: task.title, body: NEW_BODY } },
    ]);
    // And the note keeps the pushed body but gains the remote status
    const written = vault.written[0]!;
    expect(written.path).toBe(path);
    expect(written.content).toContain(`status: Shipped`);
    expect(written.content).toContain(NEW_BODY);
    // And the baseline is refreshed from the push response
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.lastSyncedBodyHash).toBe(hash(NEW_BODY));
    expect(syncState.setCalls[0]!.lastSyncedStatus).toBe('Shipped');
  });

  it('materialises via the create action when no status record exists', async () => {
    // Given — a note with no status record (a lost or never-written record)
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    vault.notes.set(path, content);
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the note edit is reconciled
    await action.execute({ notePath: path, ...context });

    // Then — the reconcile delegates to the create action instead of pushing
    expect(projectManagement.updateCalls).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(vault.renamed).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });
});
