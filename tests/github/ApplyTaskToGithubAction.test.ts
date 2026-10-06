import { describe, expect, it } from 'vitest';
import { ApplyTaskToGithubAction } from '../../src/github/ApplyTaskToGithubAction.js';
import { toIssueBody } from '../../src/vault/Checklist.js';
import { hash } from '../../src/shared/hash.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';
import type { ProjectIdentityData } from '../../src/projects/ProjectIdentityData.js';
import type { TaskData } from '../../src/shared/TaskData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports: record the writes the writer asks for, so its field-level
// gates (write only what differs) and its base advance are what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  updateCalls: Array<{ url: string; title: string; body: string }> = [];
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  boardStatusCalls: Array<{ issueUrl: string; optionId: string }> = [];
  addBoardItemCalls: Array<{ projectNodeId: string; issueUrl: string }> = [];
  failUpdate = false;

  async updateTask(
    url: string,
    input: { title: string; body: string },
  ): Promise<GithubTaskData> {
    if (this.failUpdate) {
      throw new Error('boom');
    }
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
  async fetchProjectDetail(): Promise<never> {
    throw new Error('not used in this test');
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
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
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
const notePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
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

function issue(overrides: Partial<GithubTaskData> = {}): GithubTaskData {
  return {
    url,
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the bug',
    body: 'The bug happens on resize.',
    state: 'open',
    createdAt: '2026-09-18T09:00:00Z',
    lastEditedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T10:00:00Z',
    labels: ['type: task'],
    parentUrl: null,
    ...overrides,
  };
}

// The winning task (real body) or the raw remote view; both are canonical.
function task(overrides: Partial<TaskData> = {}): TaskData {
  return taskData({
    id: 'uuid-42',
    notePath,
    mirrors: { github: url },
    title: 'Fix the bug',
    body: 'The bug happens on resize.',
    status: 'Building',
    completedAt: null,
    type: 'task',
    ...overrides,
  });
}

function makeAction(syncState: FakeSyncState, port: FakeProjectManagement) {
  return new ApplyTaskToGithubAction(port, syncState);
}

function seedRecord(syncState: FakeSyncState, base: TaskData | null = null) {
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: { handle: url, base },
  });
}

describe('SYNC-1 — a vault change flows outward to GitHub', () => {
  it('writes the issue body and title when they differ', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ title: 'Fix the widget', body: 'New body.' }),
      current: task({ title: 'Fix the bug', body: 'Old body.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.updateCalls).toEqual([
      { url, title: 'Fix the widget', body: 'New body.' },
    ]);
  });

  it('does not write the issue when the body and title already match', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task(),
      current: task(),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.updateCalls).toEqual([]);
  });

  it('closes the issue when the winning task is completed', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ completedAt: '', status: 'Shipped' }),
      current: task({ completedAt: null }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('reopens the issue when the winning task is not completed', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ completedAt: null }),
      current: task({ completedAt: '' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.stateCalls).toEqual([{ url, state: 'open' }]);
  });

  it('moves the board card only when the lane differs', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ status: 'Shipped' }),
      current: task({ status: 'Building' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_5' },
    ]);
  });

  it('does not move the card when the lane already matches', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ status: 'Building' }),
      current: task({ status: 'Building' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.boardStatusCalls).toEqual([]);
  });

  it('adds a missing card and places it in the winning lane', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ status: 'Building' }),
      current: task({ status: '' }),
      hasCard: false,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: url },
    ]);
    expect(port.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_4' },
    ]);
  });

  it('adds a card without a lane when the winning lane is empty', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ status: '' }),
      current: task({ status: '' }),
      hasCard: false,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.addBoardItemCalls).toHaveLength(1);
    expect(port.boardStatusCalls).toEqual([]);
  });

  it('skips the board for a project with no stored identity', async () => {
    const syncState = new FakeSyncState();
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ status: 'Shipped' }),
      current: task({ status: 'Building' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.boardStatusCalls).toEqual([]);
    expect(port.addBoardItemCalls).toEqual([]);
  });

  it('keeps the remote title when only the body changed', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ title: 'fix the bug', body: 'New body.' }),
      current: task({ title: 'Fix the Bug!', body: 'Old body.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.updateCalls).toEqual([
      { url, title: 'Fix the Bug!', body: 'New body.' },
    ]);
  });

  it('advances the base to what the issue now carries, after the write', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    seedRecord(
      syncState,
      taskData({ id: 'uuid-42', notePath, body: hash('old body') }),
    );
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ body: 'A vault-side edit.', status: 'Building' }),
      current: task({ body: 'Old body.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    const base = syncState.baseOf('uuid-42', 'github');
    expect(base?.body).toBe(hash(toIssueBody('A vault-side edit.')));
    expect(base?.status).toBe('Building');
    expect(base?.body).not.toBe('A vault-side edit.');
  });

  it('repairs an old-format base digest without an API write when content matches', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    seedRecord(
      syncState,
      taskData({ id: 'uuid-42', notePath, body: 'a1b2c3d4' }),
    );
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ body: 'The bug happens on resize.' }),
      current: task({ body: 'The bug happens on resize.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.updateCalls).toEqual([]);
    expect(port.stateCalls).toEqual([]);
    const base = syncState.baseOf('uuid-42', 'github');
    expect(base?.body).toBe(hash(toIssueBody('The bug happens on resize.')));
    expect(base?.body).toHaveLength(16);
  });

  it('leaves the base untouched on an equal-state pass with no API write', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const settled = taskData({
      id: 'uuid-42',
      notePath,
      title: 'Fix the bug',
      body: hash(toIssueBody('The bug happens on resize.')),
      status: 'Building',
      type: 'task',
    });
    seedRecord(syncState, settled);
    const before = syncState.baseOf('uuid-42', 'github');
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task(),
      current: task(),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(port.updateCalls).toEqual([]);
    expect(port.stateCalls).toEqual([]);
    expect(port.boardStatusCalls).toEqual([]);
    expect(port.addBoardItemCalls).toEqual([]);
    expect(syncState.baseOf('uuid-42', 'github')).toBe(before);
  });

  it('does not advance the base when the write fails', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const oldBase = taskData({
      id: 'uuid-42',
      notePath,
      body: hash('old body'),
    });
    seedRecord(syncState, oldBase);
    const port = new FakeProjectManagement();
    port.failUpdate = true;
    const action = makeAction(syncState, port);

    await expect(
      action.execute({
        task: task({ body: 'A vault-side edit.' }),
        current: task({ body: 'Old body.' }),
        hasCard: true,
        projectName: 'Acme Widgets',
        syncedAt: '2026-09-18T12:00:00Z',
      }),
    ).rejects.toThrow('boom');

    expect(syncState.baseOf('uuid-42', 'github')?.body).toBe(hash('old body'));
  });

  it('never moves the Todoist base when the GitHub mirror is written', async () => {
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const todoistBase = taskData({
      id: 'uuid-42',
      notePath,
      title: 'Fix the bug',
      status: 'Building',
    });
    syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
      github: {
        handle: url,
        base: taskData({ id: 'uuid-42', notePath, body: hash('old body') }),
      },
      todoist: { handle: 'T9', base: todoistBase },
    });
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    await action.execute({
      task: task({ body: 'A vault-side edit.', status: 'Building' }),
      current: task({ body: 'Old body.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    expect(syncState.baseOf('uuid-42', 'github')?.body).toBe(
      hash(toIssueBody('A vault-side edit.')),
    );
    expect(syncState.baseOf('uuid-42', 'todoist')).toBe(todoistBase);
    expect(syncState.handleOf('uuid-42', 'todoist')).toBe('T9');
  });
});
