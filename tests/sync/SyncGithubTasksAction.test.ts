import { describe, expect, it } from 'vitest';
import { SyncGithubTasksAction } from '../../src/sync/SyncGithubTasksAction.js';
import { ApplyTaskToGithubAction } from '../../src/tasks/ApplyTaskToGithubAction.js';
import { ApplyTaskToVaultAction } from '../../src/tasks/ApplyTaskToVaultAction.js';
import { CompleteTaskCascadeAction } from '../../src/tasks/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../src/tasks/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../src/vault/TaskNoteMapper.js';
import { toIssueBody } from '../../src/vault/Checklist.js';
import { hash } from '../../src/shared/hash.js';
import { VerdictResolver } from '../../src/shared/VerdictResolver.js';
import type { BoardItemData } from '../../src/projects/BoardItemData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectDetailData } from '../../src/projects/ProjectDetailData.js';
import type { ProjectIdentityData } from '../../src/projects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../src/github/ProjectManagementPort.js';
import type { VaultPort } from '../../src/vault/VaultPort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: the pipeline is exercised end-to-end through the real
// writers, so the fetch → map → diff → apply orchestration is what's under test.
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
    return issue({ url, title: input.title, body: input.body });
  }
  async setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<GithubTaskData> {
    this.stateCalls.push({ url, state });
    return issue({ url, state });
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
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  createIssueCalls: Array<{
    repoUrl: string;
    title: string;
    body: string;
    type: string;
  }> = [];
  createdIssueUrl = 'https://github.com/acme/widgets/issues/99';
  failCreateIssue = false;
  async createIssue(
    repoUrl: string,
    payload: { title: string; body: string; type: string },
  ): Promise<{ url: string; nodeId: string }> {
    this.createIssueCalls.push({ repoUrl, ...payload });
    if (this.failCreateIssue) {
      throw new Error('create failed');
    }
    return { url: this.createdIssueUrl, nodeId: 'I_kwDOAAAA99' };
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const url = 'https://github.com/acme/widgets/issues/42';
// A legacy issue-backed name (the record's path) and the slug a fresh note
// would get — the action must follow the record, never re-derive the path.
const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const slugNotePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
const projectName = 'Acme Widgets';
const syncedAt = '2026-09-18T12:00:00Z';
const doneLane = 'Shipped';
const defaultLane = 'Unshaped';

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

const baseBody = 'The bug happens when the widget is resized.';

function issue(overrides: Partial<GithubTaskData> = {}): GithubTaskData {
  return {
    url,
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the Bug!',
    body: baseBody,
    state: 'open',
    createdAt: '2026-09-18T09:00:00Z',
    lastEditedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T10:00:00Z',
    labels: ['type: task'],
    parentUrl: null,
    ...overrides,
  };
}

const issueA = issue();

function card(overrides: Partial<BoardItemData> = {}): BoardItemData {
  return {
    itemId: 'PVTI_1',
    type: 'ISSUE',
    issueUrl: url,
    statusOptionName: defaultLane,
    updatedAt: null,
    ...overrides,
  };
}

// The note content the vault mapper reads back, so a test seeds a note that is
// in step with the base it names.
function noteFor(opts: {
  id?: string;
  type?: string;
  body?: string;
  status: string;
}): string {
  return TaskNoteMapper.map(
    {
      type: opts.type ?? 'task',
      title: 'fix the bug',
      body: opts.body ?? baseBody,
      createdAt: null,
    },
    { projectName, syncedAt, statusName: opts.status },
  ).content;
}

interface Seed {
  baseStatus: string;
  baseCompletedAt?: string | null;
  baseBody?: string;
  baseType?: string;
  noteStatus: string;
  noteBody?: string;
  noteType?: string;
  notePath?: string;
}

// Seeds a tracked record (registry + base) and its note.
function seed(vault: FakeVault, syncState: FakeSyncState, opts: Seed): void {
  const path = opts.notePath ?? notePath;
  const base = taskData({
    id: 'uuid-42',
    notePath: path,
    title: issueA.title,
    body: hash(opts.baseBody ?? baseBody),
    status: opts.baseStatus,
    completedAt: opts.baseCompletedAt ?? null,
    type: opts.baseType ?? 'task',
  });
  syncState.seed(entityRecord({ id: 'uuid-42', notePath: path }), {
    github: { handle: url, base },
  });
  vault.notes.set(
    path,
    noteFor({
      id: 'uuid-42',
      type: opts.noteType ?? 'task',
      body: opts.noteBody ?? baseBody,
      status: opts.noteStatus,
    }),
  );
}

function makeAction(
  vault: FakeVault,
  syncState: FakeSyncState,
  projectManagement: FakeProjectManagement,
) {
  const createTaskNote = new CreateTaskNoteAction(vault, syncState, '');
  const applyToGithub = new ApplyTaskToGithubAction(
    projectManagement,
    syncState,
  );
  const applyToVault = new ApplyTaskToVaultAction(
    vault,
    syncState,
    createTaskNote,
    '',
    new CompleteTaskCascadeAction(vault, doneLane),
  );
  return new SyncGithubTasksAction(
    projectManagement,
    syncState,
    vault,
    applyToGithub,
    applyToVault,
    new VerdictResolver(doneLane),
    doneLane,
  );
}

const input = { projectName, syncedAt, includeBoard: true };

describe('SyncGithubTasksAction', () => {
  it('materialises a new typed issue and anchors a matching uuid', async () => {
    // Given — a typed issue with no record and no card
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note is created at the slug path, the card is added, and the
    // registry entity anchors it (no machine id in the note, dt-20)
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(slugNotePath);
    const record = await syncState.findByMirror('github', url);
    expect(record).not.toBeNull();
    expect(record?.notePath).toBe(slugNotePath);
    expect(syncState.baseOf(record!.id, 'github')).not.toBeNull();
    expect(vault.created[0]!.content).not.toMatch(/^id: /m);
    expect(vault.created[0]!.content).toContain('type: task');
    expect(projectManagement.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: url },
    ]);
  });

  it('seeds a materialised sub-issue affiliation from its tracked parent', async () => {
    // Given — a typed sub-issue with no record whose parent issue is tracked
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const parentUrl = 'https://github.com/acme/widgets/issues/40';
    const parentPath = 'Projecten/Acme Widgets/taken/the-slice.md';
    syncState.seed(entityRecord({ id: 'uuid-parent', notePath: parentPath }), {
      github: { handle: parentUrl },
    });
    const projectManagement = new FakeProjectManagement();
    const childUrl = 'https://github.com/acme/widgets/issues/61';
    projectManagement.detail = {
      issues: [
        issue({
          url: childUrl,
          title: 'The child',
          parentUrl,
        }),
      ],
      cards: [],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the created note's affiliation names the parent, and the base
    // carries the parent uuid
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.content).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[the-slice]]"]',
    );
    const record = await syncState.findByMirror('github', childUrl);
    expect(syncState.baseOf(record!.id, 'github')?.parent).toBe('uuid-parent');
  });

  it('materialises a sub-issue top-level when its parent is untracked', async () => {
    // Given — a typed sub-issue whose parent issue has no record
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    const childUrl = 'https://github.com/acme/widgets/issues/61';
    projectManagement.detail = {
      issues: [
        issue({
          url: childUrl,
          title: 'The child',
          parentUrl: 'https://github.com/acme/widgets/issues/40',
        }),
      ],
      cards: [],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — no parent resolves, so the note stays top-level
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.content).toContain(
      'affiliation: ["[[_Acme Widgets]]"]',
    );
    const record = await syncState.findByMirror('github', childUrl);
    expect(syncState.baseOf(record!.id, 'github')?.parent).toBeNull();
  });

  it('resolves a tracked issue by its github handle, not its note path', async () => {
    // Given — a tracked issue whose note lives at a path that is neither the
    // legacy remote-id name nor the fresh slug; the registry record (keyed by
    // handle) points at it
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const registryPath = 'Projecten/Acme Widgets/taken/7-fix-the-bug.md';
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
      notePath: registryPath,
    });
    const projectManagement = new FakeProjectManagement();
    const changed = issue({ body: 'The bug now also happens on resize.' });
    projectManagement.detail = { issues: [changed], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the pull lands on the record's note, and no new note is created
    expect(vault.created).toEqual([]);
    expect(vault.written).toEqual([
      {
        path: registryPath,
        content: expect.stringContaining('also happens'),
      },
    ]);
  });

  it('pulls a remote body change onto the note and advances the base', async () => {
    // Given — a synced note whose remote body moved
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
    const projectManagement = new FakeProjectManagement();
    const changedBody = 'The bug now also happens on resize.';
    projectManagement.detail = {
      issues: [issue({ body: changedBody })],
      cards: [card()],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note is rewritten and the vault writer advanced the base
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.path).toBe(notePath);
    expect(vault.written[0]!.content).toContain(changedBody);
    expect(syncState.baseOf('uuid-42', 'github')?.body).toBe(hash(changedBody));
  });

  it('pushes a vault body change onto the issue and advances the base', async () => {
    // Given — a synced note whose body moved locally
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
      noteBody: 'Vault edit.',
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the issue is updated and the writer advanced the base
    expect(projectManagement.updateCalls).toEqual([
      { url, title: issueA.title, body: 'Vault edit.' },
    ]);
    expect(syncState.baseOf('uuid-42', 'github')?.body).toBe(
      hash(toIssueBody('Vault edit.')),
    );
  });

  it('closes the issue and flips the note when the board lane is done', async () => {
    // Given — a tracked open issue whose card moved to the done lane
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [card({ statusOptionName: doneLane })],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note follows the lane and the issue is closed
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain(`status: ${doneLane}`);
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('does not revert a done note when the card lane is stale (the reopen veto)', async () => {
    // Given — a done note whose issue is closed but whose card sits in an
    // active lane (eventually-consistent board)
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: doneLane,
      baseCompletedAt: '',
      noteStatus: doneLane,
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issue({ state: 'closed' })],
      cards: [card({ statusOptionName: 'Building' })],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the vault is NOT reverted; the mirror's stale lane catches up to
    // the closed issue instead
    expect(vault.written).toEqual([]);
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_5' },
    ]);
    expect(projectManagement.stateCalls).toEqual([]);
  });

  it('adds a tracked issue missing from the board', async () => {
    // Given — a tracked issue with no card
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the card is added in the record's lane
    expect(projectManagement.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: url },
    ]);
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_1' },
    ]);
  });

  it('does not add a tracked issue already on the board', async () => {
    // Given — a tracked issue already on the board
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — nothing is added
    expect(projectManagement.addBoardItemCalls).toEqual([]);
  });

  it('backfills a card with no lane from the record lane', async () => {
    // Given — a tracked issue whose card has no Status value
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: 'Building',
      noteStatus: 'Building',
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [{ itemId: 'PVTI_1', type: 'ISSUE', issueUrl: url, updatedAt: null }],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the card is moved into the record's lane; issue and note untouched
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_4' },
    ]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(vault.written).toEqual([]);
  });

  it('leaves the issue alone when the board moves between non-done lanes', async () => {
    // Given — a tracked open issue whose card moved to another non-done lane
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: 'Building',
      noteStatus: 'Building',
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [card({ statusOptionName: defaultLane })],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note follows the lane, the issue is untouched
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain(`status: ${defaultLane}`);
    expect(projectManagement.stateCalls).toEqual([]);
  });

  it('pulls a remote completion over a stale vault (done-beats-open)', async () => {
    // Given — both sides changed the status: the vault reopened, the remote
    // completed
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: 'Building',
      noteStatus: defaultLane,
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [card({ statusOptionName: doneLane })],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the completion wins: the note follows and the issue is closed
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain(`status: ${doneLane}`);
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('resolves a body conflict by origin authority when no vault clock is known', async () => {
    // Given — both sides changed the body since base; the remote edit is
    // provably newer, but the vault has no mtime to compare against
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
      baseBody: 'base body',
      noteBody: 'vault body',
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [
        issue({ body: 'remote body', lastEditedAt: '2026-09-20T00:00:00Z' }),
      ],
      cards: [card()],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the vault wins (origin authority)
    expect(projectManagement.updateCalls).toEqual([
      { url, title: issueA.title, body: 'vault body' },
    ]);
  });

  it('pulls a body conflict when the remote edit postdates the vault mtime', async () => {
    // Given — both sides changed the body, and the remote edit provably came
    // after the note's last modification
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
      baseBody: 'base body',
      noteBody: 'vault body',
    });
    vault.modifiedTimes.set(notePath, '2026-09-19T00:00:00Z');
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [
        issue({ body: 'remote body', lastEditedAt: '2026-09-20T00:00:00Z' }),
      ],
      cards: [card()],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the remote wins the decisive timestamp and the note follows it
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain('remote body');
    expect(projectManagement.updateCalls).toEqual([]);
  });

  it('pushes a body conflict when the remote edit predates the vault mtime', async () => {
    // Given — both sides changed the body, and the remote edit is older
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
      baseBody: 'base body',
      noteBody: 'vault body',
    });
    vault.modifiedTimes.set(notePath, '2026-09-19T00:00:00Z');
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [
        issue({ body: 'remote body', lastEditedAt: '2026-09-18T00:00:00Z' }),
      ],
      cards: [card()],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the timestamp is not decisive and origin authority pushes
    expect(projectManagement.updateCalls).toEqual([
      { url, title: issueA.title, body: 'vault body' },
    ]);
  });

  it('pulls a status conflict when the card update postdates the vault mtime', async () => {
    // Given — both sides changed the lane and the card's own update is newer
    // than the note's mtime
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: doneLane,
      noteStatus: defaultLane,
    });
    vault.modifiedTimes.set(notePath, '2026-09-19T00:00:00Z');
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [
        card({
          statusOptionName: 'Building',
          updatedAt: '2026-09-20T00:00:00Z',
        }),
      ],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the remote lane wins on the decisive card timestamp
    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain('status: Building');
  });

  it('falls through to done-beats-open when the card update predates the vault mtime', async () => {
    // Given — the vault completed while the card moved to an open lane, and the
    // card's update is older than the note's mtime
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: 'Building',
      noteStatus: doneLane,
    });
    vault.modifiedTimes.set(notePath, '2026-09-19T00:00:00Z');
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [
        card({
          statusOptionName: defaultLane,
          updatedAt: '2026-09-18T00:00:00Z',
        }),
      ],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the card time is not decisive; the vault completion wins
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('backfills the vault-owned type from the issue label', async () => {
    // Given — a tracked note and record that predate the type promotion
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
      baseType: '',
      noteType: '',
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note's frontmatter and the record's base both carry the type
    const note = vault.notes.get(notePath) ?? '';
    expect(note).toContain('type: task');
    expect(syncState.baseOf('uuid-42', 'github')?.type).toBe('task');
  });

  it('skips the fetch when the remote is unmoved and the vault is settled', async () => {
    // Given — a settled project and a closed probe gate
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced without the board gate
    await action.execute({ ...input, includeBoard: false });

    // Then — no fetch happens
    expect(projectManagement.detailCalls).toEqual([]);
  });

  it('re-opens the fetch when the vault drifted', async () => {
    // Given — a closed probe gate but a note that no longer matches its base
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
      noteBody: 'Vault edit.',
    });
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
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
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
    // Given — a typed issue last edited long before this poll, with no record
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    const quiet = issue({
      lastEditedAt: '2026-09-01T00:00:00Z',
      labels: ['type: bug'],
    });
    projectManagement.detail = { issues: [quiet], cards: [] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — a normal poll runs
    await action.execute(input);

    // Then — the quiet issue materializes, because every poll reconciles the
    // complete tracked set rather than only what changed since a cursor
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(slugNotePath);
  });

  it('skips an untracked closed issue without materialising it', async () => {
    // Given — a closed typed issue with no record and no card
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issue({ state: 'closed' })],
      cards: [],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — nothing is created, no card is added, no GitHub write runs, and
    // no record is written
    expect(vault.created).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
    expect(projectManagement.boardStatusCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(projectManagement.updateCalls).toEqual([]);
    expect(await syncState.list()).toEqual([]);
  });

  it('does not materialise an untracked open issue without a type label', async () => {
    // Given — an open issue carrying no `type:*` label, with no record
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issue({ labels: ['bug'] })],
      cards: [],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the untyped issue is ignored: no note, no card, no record
    expect(vault.created).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(await syncState.list()).toEqual([]);
  });

  it('materialises an untracked open issue even with a stale done-lane card', async () => {
    // Given — an open typed issue with no record whose stale card sits in the
    // done lane
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = {
      issues: [issueA],
      cards: [card({ statusOptionName: doneLane })],
    };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the note materialises; the raw open state gates the decision
    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(slugNotePath);
  });

  it('skips the poll with a clear error when the project has no stored identity', async () => {
    // Given — a project with no stored identity
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    // no identity registered for the project
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    // Then — it fails with a clear error and fetches nothing
    await expect(action.execute(input)).rejects.toThrow(/no repo url/);
    expect(projectManagement.detailCalls).toEqual([]);
  });

  it('quietly skips a board with no repository attached', async () => {
    // Given — a stored identity for a board whose repo is not attached yet
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, { ...identity, repoUrl: '' });
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — no fetch happens and no error is thrown: a board without a repo
    // materializes no issues until the user attaches one
    expect(projectManagement.detailCalls).toEqual([]);
    expect(projectManagement.createIssueCalls).toEqual([]);
  });

  it('materializes a vault-born task note outward: issue, card and mirror', async () => {
    // Given — a task note in taken/ with no registry record and no mirror
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [], cards: [] };
    const action = makeAction(vault, syncState, projectManagement);
    const bornPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    vault.notes.set(
      bornPath,
      noteFor({ type: 'bug', body: 'A fresh bug.', status: defaultLane }),
    );

    // When — the project is synced
    await action.execute(input);

    // Then — the issue is created from the canonical view, the card is added
    // in the note's lane, and the mirror item carries a diff-view base
    expect(projectManagement.createIssueCalls).toEqual([
      {
        repoUrl: identity.repoUrl,
        title: 'fix the bug',
        body: 'A fresh bug.',
        type: 'bug',
      },
    ]);
    expect(projectManagement.addBoardItemCalls).toEqual([
      {
        projectNodeId: 'PVT_123',
        issueUrl: projectManagement.createdIssueUrl,
      },
    ]);
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: projectManagement.createdIssueUrl, optionId: 'PVTSSF_1' },
    ]);
    const record = await syncState.findByMirror(
      'github',
      projectManagement.createdIssueUrl,
    );
    expect(record).not.toBeNull();
    expect(record?.notePath).toBe(bornPath);
    const base = syncState.baseOf(record!.id, 'github');
    expect(base).not.toBeNull();
    expect(base?.body).toBe(hash('A fresh bug.'));
    expect(base?.type).toBe('bug');
  });

  it('leaves no mirror state when outward creation fails, and retries next pass', async () => {
    // Given — a vault-born task whose issue creation fails
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [], cards: [] };
    projectManagement.failCreateIssue = true;
    const action = makeAction(vault, syncState, projectManagement);
    const bornPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    vault.notes.set(
      bornPath,
      noteFor({ type: 'task', body: 'A fresh task.', status: defaultLane }),
    );

    // When — the project is synced
    await action.execute(input);

    // Then — no mirror item and no entity are written, and no card is added
    expect(projectManagement.createIssueCalls).toHaveLength(1);
    expect(
      await syncState.findByMirror('github', projectManagement.createdIssueUrl),
    ).toBeNull();
    expect(await syncState.findByNotePath(bornPath)).toBeNull();
    expect(projectManagement.addBoardItemCalls).toEqual([]);

    // When — the next pass succeeds
    projectManagement.failCreateIssue = false;
    await action.execute(input);

    // Then — the note materializes
    const record = await syncState.findByMirror(
      'github',
      projectManagement.createdIssueUrl,
    );
    expect(record).not.toBeNull();
    expect(record?.notePath).toBe(bornPath);
  });

  it('leaves an already-mirrored note untouched by the outward phase', async () => {
    // Given — a tracked note that already holds a github mirror
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);

    // When — the project is synced
    await action.execute(input);

    // Then — the outward phase creates nothing
    expect(projectManagement.createIssueCalls).toEqual([]);
  });

  it('opens the gate for a new vault-born note beside a settled mirror', async () => {
    // Given — a settled tracked issue and a new task note with no mirror
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [card()] };
    const action = makeAction(vault, syncState, projectManagement);
    const bornPath = 'Projecten/Acme Widgets/taken/a-new-task.md';
    vault.notes.set(
      bornPath,
      noteFor({ type: 'task', body: 'A new task.', status: defaultLane }),
    );

    // When — the board is quiet (includeBoard false)
    await action.execute({ ...input, includeBoard: false });

    // Then — the outward drift re-opens the fetch and the note materializes
    expect(projectManagement.detailCalls).toHaveLength(1);
    expect(projectManagement.createIssueCalls).toHaveLength(1);
  });
});
