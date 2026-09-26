import { describe, expect, it } from 'vitest';
import { SyncGithubTasksAction } from '../../../src/Domain/Actions/SyncGithubTasksAction.js';
import { ApplyTaskToGithubAction } from '../../../src/Domain/Actions/ApplyTaskToGithubAction.js';
import { ApplyTaskToVaultAction } from '../../../src/Domain/Actions/ApplyTaskToVaultAction.js';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import { VerdictResolver } from '../../../src/Domain/Reconciliation/VerdictResolver.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectDetailData } from '../../../src/Domain/DataTransferObjects/ProjectDetailData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

// Fakes at the ports: the pipeline is exercised end-to-end through the real
// writers, so the fetch → map → diff → apply orchestration is what's under test.
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
  identity: ProjectIdentityData | null = null;
  statuses = new Map<string, TaskData>();
  setCalls: TaskData[] = [];

  async get(url: string): Promise<TaskData | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: TaskData): Promise<void> {
    this.statuses.set(status.url, status);
    this.setCalls.push(status);
  }
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
  async findByNotePath(): Promise<TaskData | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<TaskData[]> {
    return [...this.statuses.values()];
  }
  async setIdentity(): Promise<void> {}
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

class FakeProjectManagement implements ProjectManagementPort {
  detail: ProjectDetailData = { issues: [], cards: [] };
  detailCalls: Array<{ repoUrl: string; projectNodeId: string }> = [];
  updateCalls: Array<{ url: string; title: string; body: string }> = [];
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  boardStatusCalls: Array<{ issueUrl: string; optionId: string }> = [];
  addBoardItemCalls: Array<{ projectNodeId: string; issueUrl: string }> = [];

  async fetchProjectDetail(
    repoUrl: string,
    projectNodeId: string,
  ): Promise<ProjectDetailData> {
    this.detailCalls.push({ repoUrl, projectNodeId });
    return this.detail;
  }
  async updateTask(
    url: string,
    input: { title: string; body: string },
  ): Promise<GithubTaskData> {
    this.updateCalls.push({ url, ...input });
    return { ...issueA, url, title: input.title, body: input.body };
  }
  async setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<GithubTaskData> {
    this.stateCalls.push({ url, state });
    return { ...issueA, url, state };
  }
  async setBoardStatus(
    _projectNodeId: string,
    _statusFieldId: string,
    issueUrl: string,
    optionId: string,
  ): Promise<void> {
    this.boardStatusCalls.push({ issueUrl, optionId });
  }
  async addBoardItem(projectNodeId: string, issueUrl: string): Promise<void> {
    this.addBoardItemCalls.push({ projectNodeId, issueUrl });
    this.detail.cards.push({
      itemId: 'PVTI_new',
      type: 'ISSUE',
      issueUrl,
      statusOptionName: 'Unshaped',
    });
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchTrackedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchTask(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<never> {
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
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
}

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'Unshaped',
};

const issueA: GithubTaskData = {
  url,
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: ['type: task'],
};

const identity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [
    { id: 'PVTSSF_1', name: 'Unshaped' },
    { id: 'PVTSSF_4', name: 'Building' },
    { id: 'PVTSSF_5', name: 'Shipped' },
  ],
};

function card(overrides: Partial<BoardItemData> = {}): BoardItemData {
  return {
    itemId: 'PVTI_1',
    type: 'ISSUE',
    issueUrl: url,
    statusOptionName: 'Unshaped',
    ...overrides,
  };
}

function record(overrides: Partial<TaskData> = {}): TaskData {
  return taskRecord({
    url,
    remoteId: 42,
    notePath,
    body: hash(issueA.body),
    updatedAt: issueA.updatedAt,
    status: 'Unshaped',
    title: issueA.title,
    ...overrides,
  });
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
  const applyToGithub = new ApplyTaskToGithubAction(
    projectManagement,
    syncState,
  );
  const applyToVault = new ApplyTaskToVaultAction(
    vault,
    syncState,
    createTaskNote,
    'Templates/Task.md',
  );
  return new SyncGithubTasksAction(
    projectManagement,
    syncState,
    vault,
    applyToGithub,
    applyToVault,
    new VerdictResolver(),
    'Shipped',
  );
}

const input = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  includeBoard: true,
};

describe('SyncGithubTasksAction', () => {
  it('fetches the project detail in one call and materialises a new typed issue', async () => {
    // Given — a typed issue with no record and no card
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — one detail fetch, the note is created, the card is added
    expect(projectManagement.detailCalls).toEqual([
      { repoUrl: identity.repoUrl, projectNodeId: identity.projectNodeId },
    ]);
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(notePath);
    expect(projectManagement.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: url },
    ]);
  });

  it('skips issues without a type label', async () => {
    // Given — a typed issue and an untyped one
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA, { ...issueA, url: `${url}/43`, labels: ['bug'] }],
      cards: [],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — only the typed issue materialises
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(notePath);
  });

  it('pulls a remote body change onto the note', async () => {
    // Given — a synced note whose remote body moved
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record());
    vault.notes.set(notePath, TaskNoteMapper.map(issueA, context).content);
    const projectManagement = new FakeProjectManagement();
    const changed = { ...issueA, body: 'The bug now also happens on resize.' };
    projectManagement.detail = { issues: [changed], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note is rewritten with the new body
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.path).toBe(notePath);
    expect(vault.written[0]!.content).toContain(
      'The bug now also happens on resize.',
    );
  });

  it('pushes a vault body change onto the issue', async () => {
    // Given — a synced note whose body moved locally
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record());
    vault.notes.set(
      notePath,
      TaskNoteMapper.map({ ...issueA, body: 'Vault edit.' }, context).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the issue is updated with the vault body
    expect(projectManagement.updateCalls).toEqual([
      { url, title: issueA.title, body: 'Vault edit.' },
    ]);
  });

  it('closes the issue and flips the note when the board lane is done', async () => {
    // Given — a tracked open issue whose card moved to the done lane
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record());
    vault.notes.set(notePath, TaskNoteMapper.map(issueA, context).content);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [card({ statusOptionName: 'Shipped' })],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note follows the lane and the issue is closed
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain('status: Shipped');
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('adds a tracked issue missing from the board', async () => {
    // Given — a tracked issue with no card
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record());
    vault.notes.set(notePath, TaskNoteMapper.map(issueA, context).content);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the card is added
    expect(projectManagement.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: url },
    ]);
  });

  it('does not add a tracked issue already on the board', async () => {
    // Given — a tracked issue already on the board
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record());
    vault.notes.set(notePath, TaskNoteMapper.map(issueA, context).content);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — nothing is added
    expect(projectManagement.addBoardItemCalls).toEqual([]);
  });

  it('skips the fetch when the remote is unmoved and the vault is settled', async () => {
    // Given — a settled project and a closed probe gate
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record());
    vault.notes.set(notePath, TaskNoteMapper.map(issueA, context).content);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced without the board gate
    await action.execute({ ...input, includeBoard: false });

    // Then — no fetch happens
    expect(projectManagement.detailCalls).toEqual([]);
  });

  it('re-opens the fetch when the vault drifted', async () => {
    // Given — a closed probe gate but a note that no longer matches its record
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record());
    vault.notes.set(
      notePath,
      TaskNoteMapper.map({ ...issueA, body: 'Vault edit.' }, context).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced without the board gate
    await action.execute({ ...input, includeBoard: false });

    // Then — the drift re-opens the fetch and the vault change is pushed
    expect(projectManagement.detailCalls).toHaveLength(1);
    expect(projectManagement.updateCalls).toEqual([
      { url, title: issueA.title, body: 'Vault edit.' },
    ]);
  });

  it('performs no writes on a second poll over a settled project', async () => {
    // Given — a fully settled project
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record());
    vault.notes.set(notePath, TaskNoteMapper.map(issueA, context).content);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is polled twice
    await action.execute(input);
    vault.created = [];
    vault.written = [];
    vault.renamed = [];
    projectManagement.updateCalls = [];
    projectManagement.stateCalls = [];
    projectManagement.boardStatusCalls = [];
    projectManagement.addBoardItemCalls = [];
    await action.execute(input);

    // Then — the settled second poll writes nothing
    expect(vault.created).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(vault.renamed).toEqual([]);
    expect(projectManagement.updateCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(projectManagement.boardStatusCalls).toEqual([]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
  });

  it('materializes a quiet typed issue whose update predates the poll', async () => {
    // Given — a typed issue last updated long before this poll, with no record
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const projectManagement = new FakeProjectManagement();
    const quiet = {
      ...issueA,
      updatedAt: '2026-09-01T00:00:00Z',
      labels: ['type: bug'],
    };
    projectManagement.detail = { issues: [quiet], cards: [] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — a normal poll runs
    await action.execute(input);

    // Then — the quiet issue materializes, because every poll reconciles the
    // complete tracked set rather than only what changed since a cursor
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(notePath);
  });

  it('adds a new closed issue and sets its done lane', async () => {
    // Given — a newly tracked closed issue with no record and no card
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [{ ...issueA, state: 'closed' }],
      cards: [],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the added card sits in the done lane
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_5' },
    ]);
  });

  it('leaves the issue alone when the board moves between non-done lanes', async () => {
    // Given — a tracked open issue whose card moved to another non-done lane
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record({ status: 'Building' }));
    vault.notes.set(
      notePath,
      TaskNoteMapper.map(issueA, { ...context, statusName: 'Building' })
        .content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [card({ statusOptionName: 'Unshaped' })],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note follows the lane, the issue is untouched
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain('status: Unshaped');
    expect(projectManagement.stateCalls).toEqual([]);
  });

  it('reopens the issue when the board lane is not done but the issue is closed', async () => {
    // Given — a tracked closed issue whose card moved to a non-done lane
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record({ status: 'Shipped' }));
    vault.notes.set(
      notePath,
      TaskNoteMapper.map(issueA, { ...context, statusName: 'Shipped' }).content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [{ ...issueA, state: 'closed' }],
      cards: [card({ statusOptionName: 'Building' })],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note follows the lane and the issue is reopened
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain('status: Building');
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'open' }]);
  });

  it('backfills a card with no lane from the record lane', async () => {
    // Given — a tracked issue whose card has no TaskData value
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = identity;
    syncState.statuses.set(url, record({ status: 'Building' }));
    vault.notes.set(
      notePath,
      TaskNoteMapper.map(issueA, { ...context, statusName: 'Building' })
        .content,
    );
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [{ itemId: 'PVTI_1', type: 'ISSUE', issueUrl: url }],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the card is moved into the record's lane, issue and note untouched
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_4' },
    ]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(vault.written).toEqual([]);
  });

  it('skips the poll with a clear error when the project has no stored identity', async () => {
    // Given — a project with no stored identity
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identity = null;
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    // Then — it fails with a clear error and fetches nothing
    await expect(action.execute(input)).rejects.toThrow(/no repo url/);
    expect(projectManagement.detailCalls).toEqual([]);
  });
});
