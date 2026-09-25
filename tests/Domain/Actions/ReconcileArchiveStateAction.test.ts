import { describe, expect, it } from 'vitest';
import { ReconcileArchiveStateAction } from '../../../src/Domain/Actions/ReconcileArchiveStateAction.js';
import type { ArchiveBaselineData } from '../../../src/Domain/DataTransferObjects/ArchiveBaselineData.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the vault holds a path set and actually moves files, the
// sync state holds Status records and baselines and actually relocates them,
// and the project management fake records the board mutations. The action's
// reconciliation is what's under test, and the fakes' real movement is what
// makes idempotency observable.
class FakeVault implements VaultPort {
  paths = new Set<string>();
  moveCalls: Array<{ from: string; to: string }> = [];
  renames: Array<{ from: string; to: string }> = [];
  failMove = false;

  async moveFolder(fromPrefix: string, toPrefix: string): Promise<void> {
    this.moveCalls.push({ from: fromPrefix, to: toPrefix });
    if (this.failMove) {
      throw new Error('move failed');
    }
    const from = fromPrefix.endsWith('/') ? fromPrefix : `${fromPrefix}/`;
    const to = toPrefix.endsWith('/') ? toPrefix : `${toPrefix}/`;
    for (const path of [...this.paths]) {
      if (path.startsWith(from)) {
        const newPath = `${to}${path.slice(from.length)}`;
        this.paths.delete(path);
        this.paths.add(newPath);
        this.renames.push({ from: path, to: newPath });
      }
    }
  }

  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
  async listNotesInFolder(): Promise<string[]> {
    return [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return [];
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

class FakeSyncState implements SyncStatePort {
  identity: ProjectIdentityData | null = {
    repoUrl: 'https://github.com/acme/widgets',
    repoNodeId: 'R_kgDOAAAA',
    projectNodeId: 'PVT_123',
    statusFieldId: 'PVTF_456',
    statusOptions: [],
  };
  records: Status[] = [];
  saved: Status[] = [];
  baselines = new Map<string, ArchiveBaselineData>();
  baselineSets: Array<{ projectName: string; baseline: ArchiveBaselineData }> =
    [];

  async get(): Promise<Status | null> {
    return null;
  }
  async set(status: Status): Promise<void> {
    this.saved.push(status);
    const index = this.records.findIndex((record) => record.url === status.url);
    if (index >= 0) {
      this.records[index] = status;
    } else {
      this.records.push(status);
    }
  }
  async findByNotePath(): Promise<Status | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async list(): Promise<Status[]> {
    return this.records;
  }
  async setIdentity(): Promise<void> {}
  async getIdentity(): Promise<ProjectIdentityData | null> {
    return this.identity;
  }
  async getLastProjectUpdate(): Promise<string | null> {
    return null;
  }
  async setLastProjectUpdate(): Promise<void> {}
  async getArchiveBaseline(
    projectName: string,
  ): Promise<ArchiveBaselineData | null> {
    return this.baselines.get(projectName) ?? null;
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

  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    this.baselineSets.push({ projectName, baseline });
    this.baselines.set(projectName, baseline);
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  closedCalls: Array<{ projectNodeId: string; closed: boolean }> = [];
  lockedNodeIds: string[] = [];
  failLock = false;

  async setProjectClosed(
    projectNodeId: string,
    closed: boolean,
  ): Promise<void> {
    this.closedCalls.push({ projectNodeId, closed });
  }

  async lockIssue(nodeId: string): Promise<void> {
    if (this.failLock) {
      throw new Error('lock failed');
    }
    this.lockedNodeIds.push(nodeId);
  }

  async fetchProjectStates(): Promise<Map<string, ProjectStateData>> {
    return new Map();
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
  async fetchUnpromotedIssues(): Promise<GithubTaskData[]> {
    return [];
  }
  async fetchTask(url: string): Promise<GithubTaskData> {
    const number = Number(url.split('/').pop());
    return {
      url,
      remoteId: number,
      nodeId: `I_kwDOAAAA${number}`,
      title: 'Fix the bug',
      body: '',
      state: 'open',
      updatedAt: '2026-09-18T11:00:00Z',
      labels: [],
    };
  }
  async updateTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setTaskState(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchBoardItems(): Promise<BoardItemData[]> {
    return [];
  }
  async setBoardStatus(): Promise<void> {}
  async addBoardItem(): Promise<void> {}
  async addLabel(): Promise<void> {}
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }

  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const syncedAt = '2026-09-24T12:00:00Z';
const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const archivedTaskPath = 'Archief/Acme Widgets/taken/42-fix-the-bug.md';
const issueUrl = 'https://github.com/acme/widgets/issues/42';

function record(notePath: string, overrides: Partial<Status> = {}): Status {
  return {
    url: issueUrl,
    remoteId: 42,
    notePath,
    lastSyncedBodyHash: 'abc',
    lastSyncedRemoteUpdatedAt: '2026-09-18T11:00:00Z',
    lastSyncedStatus: 'Building',
    lastSyncedTitle: 'Fix the bug',
    ...overrides,
  };
}

function setup() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const port = new FakeProjectManagement();
  const action = new ReconcileArchiveStateAction(
    port,
    vault,
    syncState,
    'Shipped',
  );
  return { action, port, vault, syncState };
}

describe('ReconcileArchiveStateAction', () => {
  it('adopts the first observation without transitioning', async () => {
    // Given — a project discovered mid-life with no baseline, its folder and
    // board already disagreeing
    const { action, port, vault, syncState } = setup();
    vault.paths.add(taskPath);

    // When — the first observation is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: false,
      closed: true,
      syncedAt,
    });

    // Then — the pair is adopted as the baseline and nothing is transitioned
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: false, closed: true },
      },
    ]);
    expect(port.closedCalls).toEqual([]);
    expect(vault.moveCalls).toEqual([]);
  });

  it('applies a vault gesture to the board: the folder moved, the board follows', async () => {
    // Given — a settled active project whose folder the user just moved to
    // Archief
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(archivedTaskPath);

    // When — the location change is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: false,
      syncedAt,
    });

    // Then — the board is closed to match, the folder is not moved again, and
    // the settled baseline is stored
    expect(port.closedCalls).toEqual([
      { projectNodeId: 'PVT_123', closed: true },
    ]);
    expect(vault.moveCalls).toEqual([]);
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: true, closed: true },
      },
    ]);
  });

  it('applies a vault gesture to the board: the folder moved back, the board reopens', async () => {
    // Given — a settled archived project whose folder the user just moved back
    // to Projecten
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: true,
      closed: true,
    });
    vault.paths.add(taskPath);

    // When — the location change is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: false,
      closed: true,
      syncedAt,
    });

    // Then — the board is reopened to match, the folder is not moved again
    expect(port.closedCalls).toEqual([
      { projectNodeId: 'PVT_123', closed: false },
    ]);
    expect(vault.moveCalls).toEqual([]);
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: false, closed: false },
      },
    ]);
  });

  it('applies a GitHub gesture to the vault: a closed board archives the folder', async () => {
    // Given — a settled active project whose board was just closed on GitHub
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add('Projecten/Acme Widgets/_home.md');
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));

    // When — the board change is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: false,
      closed: true,
      syncedAt,
    });

    // Then — the folder moves to Archief, the Status records relocate, the
    // board is left as it is, and the settled baseline is stored
    expect(port.closedCalls).toEqual([]);
    expect([...vault.paths].sort()).toEqual([
      'Archief/Acme Widgets/_home.md',
      archivedTaskPath,
    ]);
    expect(syncState.saved).toEqual([
      { ...record(taskPath), notePath: archivedTaskPath },
    ]);
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: true, closed: true },
      },
    ]);
  });

  it('applies a GitHub gesture to the vault: a reopened board unarchives the folder', async () => {
    // Given — a settled archived project whose board was just reopened
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: true,
      closed: true,
    });
    vault.paths.add('Archief/Acme Widgets/_home.md');
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));

    // When — the board change is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: false,
      syncedAt,
    });

    // Then — the folder moves back to Projecten, the Status records relocate
    expect(port.closedCalls).toEqual([]);
    expect([...vault.paths].sort()).toEqual([
      'Projecten/Acme Widgets/_home.md',
      taskPath,
    ]);
    expect(syncState.saved).toEqual([
      { ...record(archivedTaskPath), notePath: taskPath },
    ]);
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: false, closed: false },
      },
    ]);
  });

  it('resolves a conflict in the vault’s favour: the board follows, no folder move', async () => {
    // Given — a settled active project whose folder was moved to Archief and
    // whose board was closed in the same window
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(archivedTaskPath);

    // When — the conflict is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: true,
      syncedAt,
    });

    // Then — the vault wins: the board is closed to match and the folder is
    // left where the user put it
    expect(port.closedCalls).toEqual([
      { projectNodeId: 'PVT_123', closed: true },
    ]);
    expect(vault.moveCalls).toEqual([]);
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: true, closed: true },
      },
    ]);
  });

  it('does nothing when the observation matches the baseline', async () => {
    // Given — a settled archived project
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: true,
      closed: true,
    });
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));

    // When — the settled state is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: true,
      syncedAt,
    });

    // Then — nothing is written, not even the baseline
    expect(port.closedCalls).toEqual([]);
    expect(vault.moveCalls).toEqual([]);
    expect(syncState.saved).toEqual([]);
    expect(syncState.baselineSets).toEqual([]);
  });

  it('leaves the old baseline when the reconciliation throws', async () => {
    // Given — a settled active project whose board was closed, and a vault
    // move that fails
    const { action, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(taskPath);
    vault.failMove = true;

    // When — the board change is reconciled and the move throws
    await expect(
      action.execute({
        projectName: 'Acme Widgets',
        locationArchived: false,
        closed: true,
        syncedAt,
      }),
    ).rejects.toThrow('move failed');

    // Then — the old baseline stands, so the next tick retries
    expect(syncState.baselines.get('Acme Widgets')).toEqual({
      locationArchived: false,
      closed: false,
    });
    expect(syncState.baselineSets).toEqual([]);
  });

  it('is idempotent: a second pass over the settled state writes nothing', async () => {
    // Given — a project that has just been archived by a board gesture
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: false,
      closed: true,
      syncedAt,
    });
    const moves = vault.renames.length;
    const saves = syncState.saved.length;
    const baselineWrites = syncState.baselineSets.length;

    // When — the next tick sees the settled state (archived and closed)
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: true,
      syncedAt,
    });

    // Then — the first pass's writes stand and nothing more is written
    expect(port.closedCalls).toEqual([]);
    expect(vault.renames).toHaveLength(moves);
    expect(syncState.saved).toHaveLength(saves);
    expect(syncState.baselineSets).toHaveLength(baselineWrites);
  });

  it('skips a transition for a project with no stored identity', async () => {
    // Given — a settled project whose identity was never persisted, and a
    // location change
    const { action, port, vault, syncState } = setup();
    syncState.identity = null;
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(archivedTaskPath);

    // When — the location change is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: false,
      syncedAt,
    });

    // Then — nothing is written and the baseline is left for a later retry
    expect(port.closedCalls).toEqual([]);
    expect(vault.moveCalls).toEqual([]);
    expect(syncState.baselineSets).toEqual([]);
  });

  it('locks unshipped issues when a GitHub gesture archives the project', async () => {
    // Given — a settled active project whose board was just closed on GitHub
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));

    // When — the board change is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: false,
      closed: true,
      syncedAt,
    });

    // Then — the unshipped issue's conversation is locked with the nodeId the
    // fetch returned, and the settled baseline is stored
    expect(port.lockedNodeIds).toEqual(['I_kwDOAAAA42']);
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: true, closed: true },
      },
    ]);
  });

  it('locks unshipped issues when a vault gesture archives the project', async () => {
    // Given — a settled active project whose folder the user just moved to
    // Archief, so no board move is needed
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));

    // When — the location change is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: false,
      syncedAt,
    });

    // Then — the unshipped issue's conversation is locked
    expect(port.lockedNodeIds).toEqual(['I_kwDOAAAA42']);
  });

  it('skips shipped issues when archiving: the vault decides done', async () => {
    // Given — an active project holding one unshipped and one shipped issue
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));
    syncState.records.push(
      record('Projecten/Acme Widgets/taken/43-shipped.md', {
        url: 'https://github.com/acme/widgets/issues/43',
        remoteId: 43,
        lastSyncedStatus: 'Shipped',
      }),
    );

    // When — the project is archived
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: false,
      closed: true,
      syncedAt,
    });

    // Then — only the unshipped issue is locked
    expect(port.lockedNodeIds).toEqual(['I_kwDOAAAA42']);
  });

  it('locks only the archived project’s issues', async () => {
    // Given — an active project plus an unrelated project's record
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));
    syncState.records.push(
      record('Projecten/Other Project/taken/99-elsewhere.md', {
        url: 'https://github.com/acme/widgets/issues/99',
        remoteId: 99,
      }),
    );

    // When — the project is archived
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: false,
      closed: true,
      syncedAt,
    });

    // Then — only the archived project's issue is locked
    expect(port.lockedNodeIds).toEqual(['I_kwDOAAAA42']);
  });

  it('does not lock when a project is unarchived', async () => {
    // Given — a settled archived project whose board was just reopened
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: true,
      closed: true,
    });
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));

    // When — the board change is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: false,
      syncedAt,
    });

    // Then — nothing is locked (and nothing is unlocked)
    expect(port.lockedNodeIds).toEqual([]);
  });

  it('does not lock on first-run adoption', async () => {
    // Given — a project discovered mid-life with no baseline
    const { action, port, vault, syncState } = setup();
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));

    // When — the first observation is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: true,
      syncedAt,
    });

    // Then — the pair is adopted and nothing is locked
    expect(port.lockedNodeIds).toEqual([]);
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: true, closed: true },
      },
    ]);
  });

  it('does not lock on an already-archived no-op pass', async () => {
    // Given — a settled archived project
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: true,
      closed: true,
    });
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));

    // When — the settled state is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      locationArchived: true,
      closed: true,
      syncedAt,
    });

    // Then — nothing is locked and nothing is written
    expect(port.lockedNodeIds).toEqual([]);
    expect(syncState.baselineSets).toEqual([]);
  });

  it('leaves the baseline unwritten when a lock fails, so the next tick retries', async () => {
    // Given — a settled active project whose board was closed, and a lock that
    // fails
    const { action, port, vault, syncState } = setup();
    syncState.baselines.set('Acme Widgets', {
      locationArchived: false,
      closed: false,
    });
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));
    port.failLock = true;

    // When — the board change is reconciled and the lock throws
    await expect(
      action.execute({
        projectName: 'Acme Widgets',
        locationArchived: false,
        closed: true,
        syncedAt,
      }),
    ).rejects.toThrow('lock failed');

    // Then — the old baseline stands, so the next tick retries the whole
    // reconciliation
    expect(syncState.baselineSets).toEqual([]);
    expect(syncState.baselines.get('Acme Widgets')).toEqual({
      locationArchived: false,
      closed: false,
    });
  });

  it('re-activates a project: folder back, board reopened, baseline active', async () => {
    // Given — an archived project with a relocated Status record
    const { action, port, vault, syncState } = setup();
    vault.paths.add('Archief/Acme Widgets/_home.md');
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));

    // When — the project is re-activated
    await action.reactivate('Acme Widgets');

    // Then — the folder moves back, the board reopens, the Status records
    // relocate, and the baseline settles to active
    expect([...vault.paths].sort()).toEqual([
      'Projecten/Acme Widgets/_home.md',
      taskPath,
    ]);
    expect(port.closedCalls).toEqual([
      { projectNodeId: 'PVT_123', closed: false },
    ]);
    expect(syncState.saved).toEqual([
      { ...record(archivedTaskPath), notePath: taskPath },
    ]);
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: false, closed: false },
      },
    ]);
  });
});
