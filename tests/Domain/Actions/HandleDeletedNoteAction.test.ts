import { describe, expect, it } from 'vitest';
import { HandleDeletedNoteAction } from '../../../src/Domain/Actions/HandleDeletedNoteAction.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { taskRecord } from '../../helpers/records.js';

// Fakes at the ports: record the card deletion, the state change and the
// record removal the action asks for, so the action's own behaviour (find →
// delete card → close → remove) is what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  stateCalls: Array<{ url: string; state: 'open' | 'closed' }> = [];
  deleteCardCalls: Array<{ projectNodeId: string; issueUrl: string }> = [];

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
    return {
      url,
      remoteId: 42,
      nodeId: 'I_kwDOAAAA42',
      title: 'Fix the Bug!',
      body: 'The bug happens when the widget is resized.',
      state,
      updatedAt: '2026-09-18T12:30:00Z',
      labels: ['type: task'],
    };
  }
  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setBoardStatus(): Promise<void> {
    throw new Error('not used in this test');
  }
  async addBoardItem(): Promise<void> {
    throw new Error('not used in this test');
  }
  async deleteCard(projectNodeId: string, issueUrl: string): Promise<void> {
    this.deleteCardCalls.push({ projectNodeId, issueUrl });
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
  removed: string[] = [];
  identity: ProjectIdentityData | null = null;

  async get(url: string): Promise<TaskData | null> {
    return this.statuses.get(url) ?? null;
  }
  async set(status: TaskData): Promise<void> {
    this.statuses.set(status.url, status);
  }
  async findByNotePath(notePath: string): Promise<TaskData | null> {
    for (const status of this.statuses.values()) {
      if (status.notePath === notePath) {
        return status;
      }
    }
    return null;
  }
  async remove(url: string): Promise<void> {
    this.statuses.delete(url);
    this.removed.push(url);
  }
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
    status: 'open',
    title: task.title,
    ...overrides,
  });
}

function makeAction(
  syncState: FakeSyncState,
  projectManagement: FakeProjectManagement,
) {
  return new HandleDeletedNoteAction(syncState, projectManagement, 'Shipped');
}

describe('HandleDeletedNoteAction', () => {
  it('deletes the card, closes the issue and removes the record for a tracked note', async () => {
    // Given — a tracked note (a status record exists for its path) with an identity
    const projectManagement = new FakeProjectManagement();
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
    const action = makeAction(syncState, projectManagement);

    // When — the note is deleted
    await action.execute({ notePath, projectName });

    // Then — the card is deleted, the issue is closed, and the record is removed
    expect(projectManagement.deleteCardCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: task.url },
    ]);
    expect(projectManagement.stateCalls).toEqual([
      { url: task.url, state: 'closed' },
    ]);
    expect(syncState.removed).toEqual([task.url]);
    expect(syncState.statuses.has(task.url)).toBe(false);
  });

  it('still closes and removes when the issue has no card', async () => {
    // Given — a tracked note whose issue is absent from the board (the port's
    // delete is a no-op)
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    syncState.statuses.set(task.url, makeStatus());
    syncState.identity = {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [{ id: 'PVTSSF_5', name: 'Shipped' }],
    };
    const action = makeAction(syncState, projectManagement);

    // When — the note is deleted
    await action.execute({ notePath, projectName });

    // Then — the delete is still attempted, the issue closes, the record goes,
    // and nothing throws
    expect(projectManagement.deleteCardCalls).toEqual([
      { projectNodeId: 'PVT_123', issueUrl: task.url },
    ]);
    expect(projectManagement.stateCalls).toEqual([
      { url: task.url, state: 'closed' },
    ]);
    expect(syncState.removed).toEqual([task.url]);
  });

  it('does nothing for an untracked note', async () => {
    // Given — no status record for the deleted path (an untracked file)
    const projectManagement = new FakeProjectManagement();
    const syncState = new FakeSyncState();
    const action = makeAction(syncState, projectManagement);

    // When — the note is deleted
    await action.execute({
      notePath: 'Projecten/Acme Widgets/taken/99-untracked.md',
      projectName,
    });

    // Then — nothing is deleted, closed or removed
    expect(projectManagement.deleteCardCalls).toEqual([]);
    expect(projectManagement.stateCalls).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });
});
