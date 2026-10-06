import { describe, expect, it } from 'vitest';
import { ApplyTaskToGithubAction } from '../../../src/Domain/Actions/ApplyTaskToGithubAction.js';
import { toIssueBody } from '../../../src/Domain/Notes/Checklist.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import { entityRecord, taskData } from '../../helpers/records.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

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

describe('ApplyTaskToGithubAction', () => {
  it('writes the issue body and title when they differ', async () => {
    // Given — a winning vault task whose body and title moved
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered onto GitHub
    await action.execute({
      task: task({ title: 'Fix the widget', body: 'New body.' }),
      current: task({ title: 'Fix the bug', body: 'Old body.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the issue is updated with the winning title and body
    expect(port.updateCalls).toEqual([
      { url, title: 'Fix the widget', body: 'New body.' },
    ]);
  });

  it('does not write the issue when the body and title already match', async () => {
    // Given — a winning task identical to the remote
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task(),
      current: task(),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — no issue write happens
    expect(port.updateCalls).toEqual([]);
  });

  it('closes the issue when the winning task is completed', async () => {
    // Given — a winning task marked completed, the raw issue still open
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ completedAt: '', status: 'Shipped' }),
      current: task({ completedAt: null }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the issue is closed
    expect(port.stateCalls).toEqual([{ url, state: 'closed' }]);
  });

  it('reopens the issue when the winning task is not completed', async () => {
    // Given — a winning task not completed, the raw issue closed
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ completedAt: null }),
      current: task({ completedAt: '' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the issue is reopened
    expect(port.stateCalls).toEqual([{ url, state: 'open' }]);
  });

  it('moves the board card only when the lane differs', async () => {
    // Given — a winning task in a different lane than the card
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: 'Shipped' }),
      current: task({ status: 'Building' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the card moves to the winning lane's option
    expect(port.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_5' },
    ]);
  });

  it('does not move the card when the lane already matches', async () => {
    // Given — a winning task in the same lane as the card
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: 'Building' }),
      current: task({ status: 'Building' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the card is left alone
    expect(port.boardStatusCalls).toEqual([]);
  });

  it('adds a missing card and places it in the winning lane', async () => {
    // Given — a tracked issue with no card (the remote lane is empty)
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: 'Building' }),
      current: task({ status: '' }),
      hasCard: false,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the card is added and placed in the winning lane
    expect(port.addBoardItemCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: url },
    ]);
    expect(port.boardStatusCalls).toEqual([
      { issueUrl: url, optionId: 'PVTSSF_4' },
    ]);
  });

  it('adds a card without a lane when the winning lane is empty', async () => {
    // Given — a card-less issue whose winning task has no lane
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: '' }),
      current: task({ status: '' }),
      hasCard: false,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the card is added but no lane is written
    expect(port.addBoardItemCalls).toHaveLength(1);
    expect(port.boardStatusCalls).toEqual([]);
  });

  it('skips the board for a project with no stored identity', async () => {
    // Given — a board-less project
    const syncState = new FakeSyncState();
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ status: 'Shipped' }),
      current: task({ status: 'Building' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — no board write happens
    expect(port.boardStatusCalls).toEqual([]);
    expect(port.addBoardItemCalls).toEqual([]);
  });

  it('keeps the remote title when only the body changed', async () => {
    // Given — a winning task whose body moved but whose title slug is unchanged
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning task is rendered
    await action.execute({
      task: task({ title: 'fix the bug', body: 'New body.' }),
      current: task({ title: 'Fix the Bug!', body: 'Old body.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the body is pushed with the remote's own title
    expect(port.updateCalls).toEqual([
      { url, title: 'Fix the Bug!', body: 'New body.' },
    ]);
  });

  it('advances the base to what the issue now carries, after the write', async () => {
    // Given — a tracked issue whose vault body moved
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    seedRecord(
      syncState,
      taskData({ id: 'uuid-42', notePath, body: hash('old body') }),
    );
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the winning vault task is rendered
    await action.execute({
      task: task({ body: 'A vault-side edit.', status: 'Building' }),
      current: task({ body: 'Old body.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the base is the diff view of the pushed content
    const base = syncState.baseOf('uuid-42', 'github');
    expect(base?.body).toBe(hash(toIssueBody('A vault-side edit.')));
    expect(base?.status).toBe('Building');
    // And it is a diff view, not the raw body
    expect(base?.body).not.toBe('A vault-side edit.');
  });

  it('repairs an old-format base digest without an API write when content matches', async () => {
    // Given — a record whose base carries a pre-widening 8-char digest while
    // the live issue and note bodies already agree
    const syncState = new FakeSyncState();
    syncState.identities.set('Acme Widgets', identity);
    seedRecord(
      syncState,
      taskData({ id: 'uuid-42', notePath, body: 'a1b2c3d4' }),
    );
    const port = new FakeProjectManagement();
    const action = makeAction(syncState, port);

    // When — the identical task is rendered
    await action.execute({
      task: task({ body: 'The bug happens on resize.' }),
      current: task({ body: 'The bug happens on resize.' }),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — no API write happens, but the base advances to the new digest
    expect(port.updateCalls).toEqual([]);
    expect(port.stateCalls).toEqual([]);
    const base = syncState.baseOf('uuid-42', 'github');
    expect(base?.body).toBe(hash(toIssueBody('The bug happens on resize.')));
    expect(base?.body).toHaveLength(16);
  });

  it('leaves the base untouched on an equal-state pass with no API write', async () => {
    // Given — a settled issue whose stored base already carries the winning
    // task's canonical diff view
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

    // When — the identical task is rendered
    await action.execute({
      task: task(),
      current: task(),
      hasCard: true,
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — no API write happens AND the base is not rewritten: the same
    // no-op-skip contract ApplyTaskToTodoistAction enforces.
    expect(port.updateCalls).toEqual([]);
    expect(port.stateCalls).toEqual([]);
    expect(port.boardStatusCalls).toEqual([]);
    expect(port.addBoardItemCalls).toEqual([]);
    expect(syncState.baseOf('uuid-42', 'github')).toBe(before);
  });

  it('does not advance the base when the write fails', async () => {
    // Given — a tracked issue whose write will fail
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

    // When — the winning task is rendered and the write throws
    await expect(
      action.execute({
        task: task({ body: 'A vault-side edit.' }),
        current: task({ body: 'Old body.' }),
        hasCard: true,
        projectName: 'Acme Widgets',
        syncedAt: '2026-09-18T12:00:00Z',
      }),
    ).rejects.toThrow('boom');

    // Then — the base is untouched: it advances only after a durable write
    expect(syncState.baseOf('uuid-42', 'github')?.body).toBe(hash('old body'));
  });
});
