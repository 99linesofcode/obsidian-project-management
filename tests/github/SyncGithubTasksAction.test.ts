import { describe, expect, it } from 'vitest';
import { SyncGithubTasksAction } from '../../src/github/SyncGithubTasksAction.js';
import { ApplyTaskToGithubAction } from '../../src/github/ApplyTaskToGithubAction.js';
import { ApplyTaskToVaultAction } from '../../src/tasks/ApplyTaskToVaultAction.js';
import { CompleteTaskCascadeAction } from '../../src/tasks/CompleteTaskCascadeAction.js';
import { CreateTaskNoteAction } from '../../src/tasks/CreateTaskNoteAction.js';
import { TaskNoteMapper } from '../../src/vault/TaskNoteMapper.js';
import { toIssueBody } from '../../src/vault/Checklist.js';
import { hash } from '../../src/shared/hash.js';
import { VerdictResolver } from '../../src/shared/VerdictResolver.js';
import type { BoardItemData } from '../../src/shared/BoardItemData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectDetailData } from '../../src/shared/ProjectDetailData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
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

describe('SYNC-2 — a remote change flows in and fans out', () => {
  it('materialises a new typed issue and anchors a matching uuid', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [issueA], cards: [] };
    const action = makeAction(vault, syncState, projectManagement);

    await action.execute(input);

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

    await action.execute(input);

    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.content).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[the-slice]]"]',
    );
    const record = await syncState.findByMirror('github', childUrl);
    expect(syncState.baseOf(record!.id, 'github')?.parent).toBe('uuid-parent');
  });

  it('materialises a sub-issue top-level when its parent is untracked', async () => {
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

    await action.execute(input);

    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.content).toContain(
      'affiliation: ["[[_Acme Widgets]]"]',
    );
    const record = await syncState.findByMirror('github', childUrl);
    expect(syncState.baseOf(record!.id, 'github')?.parent).toBeNull();
  });

  it('resolves a tracked issue by its github handle, not its note path', async () => {
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

    await action.execute(input);

    expect(vault.created).toEqual([]);
    expect(vault.written).toEqual([
      {
        path: registryPath,
        content: expect.stringContaining('also happens'),
      },
    ]);
  });

  it('pulls a remote body change onto the note and advances the base', async () => {
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

    await action.execute(input);

    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.path).toBe(notePath);
    expect(vault.written[0]!.content).toContain(changedBody);
    expect(syncState.baseOf('uuid-42', 'github')?.body).toBe(hash(changedBody));
  });

  it('pushes a vault body change onto the issue and advances the base', async () => {
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

    await action.execute(input);

    expect(projectManagement.updateCalls).toEqual([
      { url, title: issueA.title, body: 'Vault edit.' },
    ]);
    expect(syncState.baseOf('uuid-42', 'github')?.body).toBe(
      hash(toIssueBody('Vault edit.')),
    );
  });

  it('closes the issue and flips the note when the board lane is done', async () => {
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

    await action.execute(input);

    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain(`status: ${doneLane}`);
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('does not revert a done note when the card lane is stale (the reopen veto)', async () => {
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

    await action.execute(input);

    expect(vault.written).toEqual([]);
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_5' },
    ]);
    expect(projectManagement.stateCalls).toEqual([]);
  });

  it('adds a tracked issue missing from the board', async () => {
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

    await action.execute(input);

    expect(projectManagement.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: url },
    ]);
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_1' },
    ]);
  });

  it('does not add a tracked issue already on the board', async () => {
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

    await action.execute(input);

    expect(projectManagement.addBoardItemCalls).toEqual([]);
  });

  it('backfills a card with no lane from the record lane', async () => {
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

    await action.execute(input);

    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_4' },
    ]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(vault.written).toEqual([]);
  });

  it('leaves the issue alone when the board moves between non-done lanes', async () => {
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

    await action.execute(input);

    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain(`status: ${defaultLane}`);
    expect(projectManagement.stateCalls).toEqual([]);
  });

  it('pulls a remote completion over a stale vault (done-beats-open)', async () => {
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

    await action.execute(input);

    expect(vault.written).toHaveLength(1);
    expect(vault.written[0]!.content).toContain(`status: ${doneLane}`);
    expect(projectManagement.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('resolves a body conflict through the ladder', async () => {
    type H = {
      vault: FakeVault;
      port: FakeProjectManagement;
    };
    const cases: Array<{
      name: string;
      vaultMtime: string | null;
      remoteEditedAt: string;
      assert: (h: H) => void;
    }> = [
      {
        name: 'no vault clock: the vault wins',
        vaultMtime: null,
        remoteEditedAt: '2026-09-20T00:00:00Z',
        assert: (h) => {
          expect(h.port.updateCalls).toEqual([
            { url, title: issueA.title, body: 'vault body' },
          ]);
        },
      },
      {
        name: 'remote edit postdates the vault: the remote wins',
        vaultMtime: '2026-09-19T00:00:00Z',
        remoteEditedAt: '2026-09-20T00:00:00Z',
        assert: (h) => {
          expect(h.vault.written).toHaveLength(1);
          expect(h.vault.written[0]!.content).toContain('remote body');
          expect(h.port.updateCalls).toEqual([]);
        },
      },
      {
        name: 'remote edit predates the vault: the vault wins',
        vaultMtime: '2026-09-19T00:00:00Z',
        remoteEditedAt: '2026-09-18T00:00:00Z',
        assert: (h) => {
          expect(h.port.updateCalls).toEqual([
            { url, title: issueA.title, body: 'vault body' },
          ]);
        },
      },
    ];
    for (const c of cases) {
      const vault = new FakeVault();
      const syncState = new FakeSyncState();
      syncState.identities.set(projectName, identity);
      seed(vault, syncState, {
        baseStatus: defaultLane,
        noteStatus: defaultLane,
        baseBody: 'base body',
        noteBody: 'vault body',
      });
      if (c.vaultMtime !== null) {
        vault.modifiedTimes.set(notePath, c.vaultMtime);
      }
      const port = new FakeProjectManagement();
      port.detail = {
        issues: [
          issue({ body: 'remote body', lastEditedAt: c.remoteEditedAt }),
        ],
        cards: [card()],
      };

      await makeAction(vault, syncState, port).execute(input);

      c.assert({ vault, port });
    }
  });

  it('resolves a status conflict through the ladder', async () => {
    const pulledVault = new FakeVault();
    const pulledState = new FakeSyncState();
    pulledState.identities.set(projectName, identity);
    seed(pulledVault, pulledState, {
      baseStatus: doneLane,
      noteStatus: defaultLane,
    });
    pulledVault.modifiedTimes.set(notePath, '2026-09-19T00:00:00Z');
    const pulledPort = new FakeProjectManagement();
    pulledPort.detail = {
      issues: [issueA],
      cards: [
        card({
          statusOptionName: 'Building',
          updatedAt: '2026-09-20T00:00:00Z',
        }),
      ],
    };
    await makeAction(pulledVault, pulledState, pulledPort).execute(input);
    expect(pulledVault.written).toHaveLength(1);
    expect(pulledVault.written[0]!.content).toContain('status: Building');

    const doneVault = new FakeVault();
    const doneState = new FakeSyncState();
    doneState.identities.set(projectName, identity);
    seed(doneVault, doneState, {
      baseStatus: 'Building',
      noteStatus: doneLane,
    });
    doneVault.modifiedTimes.set(notePath, '2026-09-19T00:00:00Z');
    const donePort = new FakeProjectManagement();
    donePort.detail = {
      issues: [issueA],
      cards: [
        card({
          statusOptionName: defaultLane,
          updatedAt: '2026-09-18T00:00:00Z',
        }),
      ],
    };
    await makeAction(doneVault, doneState, donePort).execute(input);
    expect(donePort.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('backfills the vault-owned type from the issue label', async () => {
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

    await action.execute(input);

    const note = vault.notes.get(notePath) ?? '';
    expect(note).toContain('type: task');
    expect(syncState.baseOf('uuid-42', 'github')?.type).toBe('task');
  });

  it('fetches only when the board is asked for or the vault drifted', async () => {
    const settledVault = new FakeVault();
    const settledState = new FakeSyncState();
    settledState.identities.set(projectName, identity);
    seed(settledVault, settledState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
    const settledPort = new FakeProjectManagement();
    settledPort.detail = { issues: [issueA], cards: [card()] };
    await makeAction(settledVault, settledState, settledPort).execute({
      ...input,
      includeBoard: false,
    });
    expect(settledPort.detailCalls).toEqual([]);

    const driftedVault = new FakeVault();
    const driftedState = new FakeSyncState();
    driftedState.identities.set(projectName, identity);
    seed(driftedVault, driftedState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
      noteBody: 'Vault edit.',
    });
    const driftedPort = new FakeProjectManagement();
    driftedPort.detail = { issues: [issueA], cards: [card()] };
    await makeAction(driftedVault, driftedState, driftedPort).execute({
      ...input,
      includeBoard: false,
    });
    expect(driftedPort.detailCalls).toHaveLength(1);
    expect(driftedPort.updateCalls).toEqual([
      { url, title: issueA.title, body: 'Vault edit.' },
    ]);
  });

  it('performs no writes on a second poll over a settled project', async () => {
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

    await action.execute(input);
    vault.created = [];
    vault.written = [];
    vault.renamed = [];
    projectManagement.updateCalls = [];
    projectManagement.stateCalls = [];
    projectManagement.boardStatusCalls = [];
    projectManagement.addBoardItemCalls = [];
    await action.execute(input);

    expect(vault.created).toEqual([]);
    expect(vault.written).toEqual([]);
    expect(vault.renamed).toEqual([]);
    expect(projectManagement.updateCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(projectManagement.boardStatusCalls).toEqual([]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
  });

  it('materializes a quiet typed issue whose update predates the poll', async () => {
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

    await action.execute(input);

    expect(vault.created).toHaveLength(1);
    expect(vault.created[0]!.path).toBe(slugNotePath);
  });

  it('materialises only an untracked open issue that carries a type label', async () => {
    const cases: Array<{
      name: string;
      detail: { issues: GithubTaskData[]; cards: BoardItemData[] };
      expectedCreated: number;
    }> = [
      {
        name: 'a closed untracked issue',
        detail: { issues: [issue({ state: 'closed' })], cards: [] },
        expectedCreated: 0,
      },
      {
        name: 'an open issue without a type label',
        detail: { issues: [issue({ labels: ['bug'] })], cards: [] },
        expectedCreated: 0,
      },
      {
        name: 'an open typed issue with a stale done-lane card',
        detail: {
          issues: [issueA],
          cards: [card({ statusOptionName: doneLane })],
        },
        expectedCreated: 1,
      },
    ];
    for (const c of cases) {
      const vault = new FakeVault();
      const syncState = new FakeSyncState();
      syncState.identities.set(projectName, identity);
      const projectManagement = new FakeProjectManagement();
      projectManagement.detail = c.detail;

      await makeAction(vault, syncState, projectManagement).execute(input);

      expect(vault.created, c.name).toHaveLength(c.expectedCreated);
      if (c.expectedCreated > 0) {
        expect(vault.created[0]!.path).toBe(slugNotePath);
      }
    }
  });

  it('skips the poll with a clear error when the project has no stored identity', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    // no identity registered for the project
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    await expect(action.execute(input)).rejects.toThrow(/no repo url/);
    expect(projectManagement.detailCalls).toEqual([]);
  });

  it('quietly skips a board with no repository attached', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, { ...identity, repoUrl: '' });
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    await action.execute(input);

    expect(projectManagement.detailCalls).toEqual([]);
    expect(projectManagement.createIssueCalls).toEqual([]);
  });

  it('materializes a vault-born task note outward: issue, card and mirror', async () => {
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

    await action.execute(input);

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

  it('keeps a placeholder when outward creation fails, and retries without a duplicate', async () => {
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

    await action.execute(input);

    expect(projectManagement.createIssueCalls).toHaveLength(1);
    // Registry-first: the entity and its placeholder survive the failure, so
    // the next pass retries instead of materializing a second note.
    const record = await syncState.findByNotePath(bornPath);
    expect(record).not.toBeNull();
    expect(
      await syncState.findMirrorItem('github', `pendingCreation:${record!.id}`),
    ).not.toBeNull();
    expect(
      await syncState.findByMirror('github', projectManagement.createdIssueUrl),
    ).toBeNull();
    expect(projectManagement.addBoardItemCalls).toEqual([]);

    projectManagement.failCreateIssue = false;
    await action.execute(input);

    expect(projectManagement.createIssueCalls).toHaveLength(2);
    const item = await syncState.findMirrorItem(
      'github',
      projectManagement.createdIssueUrl,
    );
    expect(item?.entityId).toBe(record!.id);
    expect(
      await syncState.findMirrorItem('github', `pendingCreation:${record!.id}`),
    ).toBeNull();
    expect(projectManagement.addBoardItemCalls).toEqual([
      {
        projectNodeId: 'PVT_123',
        issueUrl: projectManagement.createdIssueUrl,
      },
    ]);
  });

  it('heals an interrupted outward creation without a duplicate issue or note', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    const bornPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    vault.notes.set(
      bornPath,
      noteFor({ type: 'bug', body: 'A fresh bug.', status: defaultLane }),
    );
    // The state a crash between createIssue and the mirror write leaves: the
    // entity and its placeholder exist; the issue exists remotely, but the
    // registry never learned its handle.
    const record = { id: 'uuid-born', notePath: bornPath };
    syncState.seed(record, {
      github: { handle: `pendingCreation:uuid-born`, base: null },
    });
    const createdUrl = projectManagement.createdIssueUrl;
    projectManagement.detail = {
      issues: [
        issue({
          url: createdUrl,
          title: 'fix the bug',
          body: 'A fresh bug.',
          labels: ['type: bug'],
        }),
      ],
      cards: [],
    };
    const action = makeAction(vault, syncState, projectManagement);

    await action.execute(input);

    // No duplicate: the orphan issue is adopted, not re-created, and no second
    // note is materialized for it.
    expect(projectManagement.createIssueCalls).toEqual([]);
    expect(vault.created).toEqual([]);
    const item = await syncState.findMirrorItem('github', createdUrl);
    expect(item?.entityId).toBe('uuid-born');
    expect(
      await syncState.findMirrorItem('github', 'pendingCreation:uuid-born'),
    ).toBeNull();
    // The per-issue loop heals the missing card (membership gap).
    expect(projectManagement.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: createdUrl },
    ]);
  });

  it('skips outward creation when the note lane is not a board option (L2)', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    const projectManagement = new FakeProjectManagement();
    projectManagement.detail = { issues: [], cards: [] };
    const action = makeAction(vault, syncState, projectManagement);
    const bornPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    vault.notes.set(
      bornPath,
      noteFor({
        type: 'task',
        body: 'A fresh task.',
        status: 'Nonexistent Lane',
      }),
    );

    await action.execute(input);

    // No issue is created for an unmappable lane, so there is no
    // issue-without-card retry loop.
    expect(projectManagement.createIssueCalls).toEqual([]);
    expect(projectManagement.addBoardItemCalls).toEqual([]);
    expect(await syncState.findByNotePath(bornPath)).toBeNull();
  });

  it('does not count an unparseable note as vault drift (L1)', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.identities.set(projectName, identity);
    seed(vault, syncState, {
      baseStatus: defaultLane,
      noteStatus: defaultLane,
    });
    // Corrupt the note so it no longer parses as a task: it must not hold the
    // probe gate open forever.
    vault.notes.set(notePath, 'this is not a task note');
    const projectManagement = new FakeProjectManagement();
    const action = makeAction(vault, syncState, projectManagement);

    await action.execute({ ...input, includeBoard: false });

    expect(projectManagement.detailCalls).toEqual([]);
  });

  it('leaves an already-mirrored note untouched by the outward phase', async () => {
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

    await action.execute(input);

    expect(projectManagement.createIssueCalls).toEqual([]);
  });

  it('opens the gate for a new vault-born note beside a settled mirror', async () => {
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

    await action.execute({ ...input, includeBoard: false });

    expect(projectManagement.detailCalls).toHaveLength(1);
    expect(projectManagement.createIssueCalls).toHaveLength(1);
  });
});
