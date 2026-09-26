import { describe, expect, it } from 'vitest';
import { PropagateStatusAction } from '../../../src/Domain/Actions/PropagateStatusAction.js';
import { BoardStatusAction } from '../../../src/Domain/Actions/BoardStatusAction.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

// Fakes at the ports: record the state change the action asks for and hold
// the status record in memory, so the action's own behaviour (PATCH state +
// baseline refresh + board mirror) is what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  boardStatusCalls: Array<{ issueUrl: string; statusOptionId: string }> = [];
  updated: GithubTaskData = {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    title: 'Fix the Bug!',
    body: 'The bug happens when the widget is resized.',
    state: 'closed',
    updatedAt: '2026-09-18T12:30:00Z',
    labels: ['type: task'],
  };

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
  async updateTask(): Promise<GithubTaskData> {
    throw new Error('not used in this test');
  }
  async setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<GithubTaskData> {
    this.stateCalls.push({ url, state });
    return this.updated;
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
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
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
  statuses = new Map<string, TaskData>();
  setCalls: TaskData[] = [];
  identity: ProjectIdentityData | null = null;

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
    return [];
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
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

const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const projectName = 'Acme Widgets';

function makeStatus(overrides: Partial<TaskData> = {}): TaskData {
  return taskRecord({
    url: task.url,
    remoteId: task.remoteId,
    notePath,
    body: hash(task.body),
    updatedAt: task.updatedAt,
    status: 'Unshaped',
    title: task.title,
    ...overrides,
  });
}

function makeAction(
  projectManagement: FakeProjectManagement,
  syncState: FakeSyncState,
) {
  const boardStatus = new BoardStatusAction(syncState, projectManagement);
  return new PropagateStatusAction(
    projectManagement,
    syncState,
    boardStatus,
    'Shipped',
  );
}

describe('PropagateStatusAction', () => {
  it('closes the issue for a done note and refreshes the baseline', async () => {
    // Given — a synced note whose status the user flipped to done
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = {
      ...task,
      state: 'closed',
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({
      url: task.url,
      statusName: 'Shipped',
      notePath,
      projectName,
    });

    // Then — the issue is closed
    expect(projectManagement.stateCalls).toEqual([
      { url: task.url, state: 'closed' },
    ]);
    // And the baseline is refreshed from the response, keeping the other fields
    expect(syncState.setCalls).toEqual([
      taskRecord({
        url: task.url,
        remoteId: task.remoteId,
        notePath,
        body: hash(task.body),
        updatedAt: '2026-09-18T12:30:00Z',
        status: 'Shipped',
        title: task.title,
        completed: true,
      }),
    ]);
  });

  it('reopens the issue for an open note and refreshes the baseline', async () => {
    // Given — a synced note whose status the user flipped back to open
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = {
      ...task,
      state: 'open',
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus({ status: 'Shipped' }));
    const action = makeAction(projectManagement, syncState);

    // When — the open status is propagated
    await action.execute({
      url: task.url,
      statusName: 'Unshaped',
      notePath,
      projectName,
    });

    // Then — the issue is reopened
    expect(projectManagement.stateCalls).toEqual([
      { url: task.url, state: 'open' },
    ]);
    // And the baseline is refreshed from the response
    expect(syncState.setCalls).toHaveLength(1);
    expect(syncState.setCalls[0]!.status).toBe('Unshaped');
    expect(syncState.setCalls[0]!.updatedAt).toBe('2026-09-18T12:30:00Z');
  });

  it('skips the issue state write when the lane done-ness is unchanged', async () => {
    // Given — a record already in an open lane, mirrored to another open lane
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus({ status: 'Unshaped' }));
    const action = makeAction(projectManagement, syncState);

    // When — the open lane is propagated
    await action.execute({
      url: task.url,
      statusName: 'Building',
      notePath,
      projectName,
    });

    // Then — the issue state is not written (both lanes are open)
    expect(projectManagement.stateCalls).toEqual([]);
  });

  it('mirrors the status onto the board when the project has an identity', async () => {
    // Given — a project with a stored identity and a done note
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = {
      ...task,
      state: 'closed',
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    syncState.identity = {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Unshaped' },
        { id: 'PVTSSF_2', name: 'Shaping' },
        { id: 'PVTSSF_3', name: 'Shaped' },
        { id: 'PVTSSF_4', name: 'Building' },
        { id: 'PVTSSF_5', name: 'Shipped' },
      ],
    };
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({
      url: task.url,
      statusName: 'Shipped',
      notePath,
      projectName,
    });

    // Then — the board TaskData is set to the done option
    expect(projectManagement.boardStatusCalls).toEqual([
      { issueUrl: task.url, statusOptionId: 'PVTSSF_5' },
    ]);
  });

  it('skips the board mirror when the project has no identity', async () => {
    // Given — a project with no stored identity (board-less)
    const projectManagement = new FakeProjectManagement();
    projectManagement.updated = {
      ...task,
      state: 'closed',
      updatedAt: '2026-09-18T12:30:00Z',
    };
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    syncState.identity = null;
    const action = makeAction(projectManagement, syncState);

    // When — the done status is propagated
    await action.execute({
      url: task.url,
      statusName: 'Shipped',
      notePath,
      projectName,
    });

    // Then — the board is left untouched
    expect(projectManagement.boardStatusCalls).toEqual([]);
  });
});
