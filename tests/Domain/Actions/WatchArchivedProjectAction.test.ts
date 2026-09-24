import { describe, expect, it } from 'vitest';
import { ReconcileArchiveStateAction } from '../../../src/Domain/Actions/ReconcileArchiveStateAction.js';
import { WatchArchivedProjectAction } from '../../../src/Domain/Actions/WatchArchivedProjectAction.js';
import type { ArchiveBaselineData } from '../../../src/Domain/DataTransferObjects/ArchiveBaselineData.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { WatchStateData } from '../../../src/Domain/DataTransferObjects/WatchStateData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the vault holds a path set and actually moves files, the
// sync state holds Status records, baselines and watch states, and the project
// management fake returns a canned activity result and records the board
// mutations. The watch action is composed with the real reconcile action, so
// the re-activation it triggers is the real unarchive path.
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
  watchStates = new Map<string, WatchStateData>();
  watchSets: Array<{ projectName: string; state: WatchStateData }> = [];

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
  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    this.baselineSets.push({ projectName, baseline });
    this.baselines.set(projectName, baseline);
  }
  async getWatchState(projectName: string): Promise<WatchStateData> {
    return this.watchStates.get(projectName) ?? { etag: null, cursor: null };
  }
  async setWatchState(
    projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    this.watchSets.push({ projectName, state });
    this.watchStates.set(projectName, state);
  }
}

class FakeProjectManagement implements ProjectManagementPort {
  activity: {
    changed: boolean;
    newestCreatedAt: string | null;
    etag: string | null;
  } = { changed: false, newestCreatedAt: null, etag: null };
  activityCalls: Array<{ repoUrl: string; etag?: string }> = [];
  closedCalls: Array<{ projectNodeId: string; closed: boolean }> = [];
  lockedNodeIds: string[] = [];

  async fetchLatestIssueActivity(
    repoUrl: string,
    etag?: string,
  ): Promise<{
    changed: boolean;
    newestCreatedAt: string | null;
    etag: string | null;
  }> {
    this.activityCalls.push(
      etag === undefined ? { repoUrl } : { repoUrl, etag },
    );
    return this.activity;
  }

  async setProjectClosed(
    projectNodeId: string,
    closed: boolean,
  ): Promise<void> {
    this.closedCalls.push({ projectNodeId, closed });
  }

  async lockIssue(nodeId: string): Promise<void> {
    this.lockedNodeIds.push(nodeId);
  }

  async fetchProjectStates(): Promise<Map<string, ProjectStateData>> {
    return new Map();
  }
  async fetchProjectIdentity(): Promise<null> {
    return null;
  }
  async fetchTrackedIssues(): Promise<TaskData[]> {
    return [];
  }
  async fetchUnpromotedIssues(): Promise<TaskData[]> {
    return [];
  }
  async fetchTask(url: string): Promise<TaskData> {
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
  const reconcile = new ReconcileArchiveStateAction(
    port,
    vault,
    syncState,
    'Shipped',
  );
  const action = new WatchArchivedProjectAction(port, syncState, reconcile);
  return { action, port, vault, syncState };
}

describe('WatchArchivedProjectAction', () => {
  it('does nothing when the repository answers 304', async () => {
    // Given — a watched project whose stored etag still matches
    const { action, port, vault, syncState } = setup();
    syncState.watchStates.set('Acme Widgets', {
      etag: 'W/"abc"',
      cursor: '2026-09-18T10:00:00Z',
    });
    port.activity = { changed: false, newestCreatedAt: null, etag: null };

    // When — the watch runs
    await action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — the stored etag was sent, and nothing is written or re-activated
    expect(port.activityCalls).toEqual([
      { repoUrl: 'https://github.com/acme/widgets', etag: 'W/"abc"' },
    ]);
    expect(syncState.watchSets).toEqual([]);
    expect(vault.moveCalls).toEqual([]);
    expect(port.closedCalls).toEqual([]);
  });

  it('adopts the newest issue as the cursor on the first watch', async () => {
    // Given — a project never watched, with a newer issue already on the repo
    const { action, port, vault, syncState } = setup();
    port.activity = {
      changed: true,
      newestCreatedAt: '2026-09-20T10:00:00Z',
      etag: 'W/"new"',
    };

    // When — the first watch runs
    await action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — the cursor is adopted without re-activating the project
    expect(syncState.watchSets).toEqual([
      {
        projectName: 'Acme Widgets',
        state: { etag: 'W/"new"', cursor: '2026-09-20T10:00:00Z' },
      },
    ]);
    expect(vault.moveCalls).toEqual([]);
    expect(port.closedCalls).toEqual([]);
  });

  it('re-activates the project when a newer issue appears', async () => {
    // Given — a watched archived project with a new issue on the repo
    const { action, port, vault, syncState } = setup();
    syncState.watchStates.set('Acme Widgets', {
      etag: 'W/"old"',
      cursor: '2026-09-18T10:00:00Z',
    });
    vault.paths.add('Archief/Acme Widgets/_home.md');
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));
    port.activity = {
      changed: true,
      newestCreatedAt: '2026-09-20T10:00:00Z',
      etag: 'W/"new"',
    };

    // When — the watch runs
    await action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — the folder moves back to Projecten
    expect([...vault.paths].sort()).toEqual([
      'Projecten/Acme Widgets/_home.md',
      taskPath,
    ]);
    // And the board reopens
    expect(port.closedCalls).toEqual([
      { projectNodeId: 'PVT_123', closed: false },
    ]);
    // And the Status records relocate
    expect(syncState.saved).toEqual([
      { ...record(archivedTaskPath), notePath: taskPath },
    ]);
    // And the baseline settles to active
    expect(syncState.baselineSets).toEqual([
      {
        projectName: 'Acme Widgets',
        baseline: { locationArchived: false, closed: false },
      },
    ]);
    // And the watch state is cleared, so the next tick's full reconcile runs
    expect(syncState.watchSets).toEqual([
      {
        projectName: 'Acme Widgets',
        state: { etag: null, cursor: null },
      },
    ]);
  });

  it('refreshes only the etag when the newest issue is not newer', async () => {
    // Given — a watched project whose newest issue equals the stored cursor
    const { action, port, vault, syncState } = setup();
    syncState.watchStates.set('Acme Widgets', {
      etag: 'W/"old"',
      cursor: '2026-09-20T10:00:00Z',
    });
    port.activity = {
      changed: true,
      newestCreatedAt: '2026-09-20T10:00:00Z',
      etag: 'W/"new"',
    };

    // When — the watch runs
    await action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — only the etag is refreshed, the cursor stands, nothing re-activates
    expect(syncState.watchSets).toEqual([
      {
        projectName: 'Acme Widgets',
        state: { etag: 'W/"new"', cursor: '2026-09-20T10:00:00Z' },
      },
    ]);
    expect(vault.moveCalls).toEqual([]);
    expect(port.closedCalls).toEqual([]);
  });

  it('refreshes only the etag when the newest activity is a pull request', async () => {
    // Given — a watched project whose newest activity is a PR, not an issue
    const { action, port, vault, syncState } = setup();
    syncState.watchStates.set('Acme Widgets', {
      etag: 'W/"old"',
      cursor: '2026-09-18T10:00:00Z',
    });
    port.activity = { changed: true, newestCreatedAt: null, etag: 'W/"new"' };

    // When — the watch runs
    await action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — only the etag is refreshed, nothing re-activates
    expect(syncState.watchSets).toEqual([
      {
        projectName: 'Acme Widgets',
        state: { etag: 'W/"new"', cursor: '2026-09-18T10:00:00Z' },
      },
    ]);
    expect(vault.moveCalls).toEqual([]);
    expect(port.closedCalls).toEqual([]);
  });

  it('skips a project with no stored identity', async () => {
    // Given — a project whose identity was never persisted
    const { action, port, syncState } = setup();
    syncState.identity = null;

    // When — the watch runs
    await action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — no repository read and no writes
    expect(port.activityCalls).toEqual([]);
    expect(syncState.watchSets).toEqual([]);
  });

  it('leaves the watch state untouched when re-activation fails', async () => {
    // Given — a watched project with a new issue and a vault move that fails
    const { action, port, vault, syncState } = setup();
    syncState.watchStates.set('Acme Widgets', {
      etag: 'W/"old"',
      cursor: '2026-09-18T10:00:00Z',
    });
    vault.paths.add(archivedTaskPath);
    vault.failMove = true;
    port.activity = {
      changed: true,
      newestCreatedAt: '2026-09-20T10:00:00Z',
      etag: 'W/"new"',
    };

    // When — the watch runs and the re-activation throws
    await expect(
      action.execute({ projectName: 'Acme Widgets', syncedAt }),
    ).rejects.toThrow('move failed');

    // Then — the watch state stands, so the next tick retries
    expect(syncState.watchSets).toEqual([]);
    expect(syncState.watchStates.get('Acme Widgets')).toEqual({
      etag: 'W/"old"',
      cursor: '2026-09-18T10:00:00Z',
    });
  });
});
