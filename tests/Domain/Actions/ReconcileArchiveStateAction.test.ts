import { describe, expect, it } from 'vitest';
import { ReconcileArchiveStateAction } from '../../../src/Domain/Actions/ReconcileArchiveStateAction.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../../../src/Domain/DataTransferObjects/ProjectStateData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { Status } from '../../../src/Domain/Models/Status.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../../src/Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the ports: the vault holds a path set and actually moves files, the
// sync state holds Status records and actually relocates them, and the project
// management fake records the board mutations. The action's reconciliation is
// what's under test, and the fakes' real movement is what makes idempotency
// observable.
class FakeVault implements VaultPort {
  paths = new Set<string>();
  moveCalls: Array<{ from: string; to: string }> = [];
  renames: Array<{ from: string; to: string }> = [];

  async moveFolder(fromPrefix: string, toPrefix: string): Promise<void> {
    this.moveCalls.push({ from: fromPrefix, to: toPrefix });
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
}

class FakeProjectManagement implements ProjectManagementPort {
  closedCalls: Array<{ projectNodeId: string; closed: boolean }> = [];

  async setProjectClosed(
    projectNodeId: string,
    closed: boolean,
  ): Promise<void> {
    this.closedCalls.push({ projectNodeId, closed });
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
  async fetchTask(): Promise<never> {
    throw new Error('not used in this test');
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

function record(notePath: string): Status {
  return {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    notePath,
    lastSyncedBodyHash: 'abc',
    lastSyncedRemoteUpdatedAt: '2026-09-18T11:00:00Z',
    lastSyncedStatus: 'Building',
    lastSyncedTitle: 'Fix the bug',
  };
}

function setup() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const port = new FakeProjectManagement();
  const action = new ReconcileArchiveStateAction(port, vault, syncState);
  return { action, port, vault, syncState };
}

describe('ReconcileArchiveStateAction', () => {
  it('archives: closes the board, moves the folder and relocates the Status records', async () => {
    // Given — an active project whose board is still open
    const { action, port, vault, syncState } = setup();
    vault.paths.add('Projecten/Acme Widgets/_home.md');
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));

    // When — the mismatch is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      archived: true,
      closed: false,
      syncedAt,
    });

    // Then — the board is closed, the folder moved and the record relocated
    expect(port.closedCalls).toEqual([
      { projectNodeId: 'PVT_123', closed: true },
    ]);
    expect([...vault.paths].sort()).toEqual([
      'Archief/Acme Widgets/_home.md',
      archivedTaskPath,
    ]);
    expect(syncState.saved).toEqual([
      { ...record(taskPath), notePath: archivedTaskPath },
    ]);
  });

  it('unarchives: moves the folder, reopens the board and relocates the Status records', async () => {
    // Given — an archived project whose board is still closed
    const { action, port, vault, syncState } = setup();
    vault.paths.add('Archief/Acme Widgets/_home.md');
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));

    // When — the mismatch is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      archived: false,
      closed: true,
      syncedAt,
    });

    // Then — the folder moved back, the board reopened and the record relocated
    expect(port.closedCalls).toEqual([
      { projectNodeId: 'PVT_123', closed: false },
    ]);
    expect([...vault.paths].sort()).toEqual([
      'Projecten/Acme Widgets/_home.md',
      taskPath,
    ]);
    expect(syncState.saved).toEqual([
      { ...record(archivedTaskPath), notePath: taskPath },
    ]);
  });

  it('does nothing when the vault and board already agree (archived and closed)', async () => {
    // Given — an archived project whose board is closed
    const { action, port, vault, syncState } = setup();
    vault.paths.add(archivedTaskPath);
    syncState.records.push(record(archivedTaskPath));

    // When — the consistent state is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      archived: true,
      closed: true,
      syncedAt,
    });

    // Then — nothing is written
    expect(port.closedCalls).toEqual([]);
    expect(vault.moveCalls).toEqual([]);
    expect(syncState.saved).toEqual([]);
  });

  it('does nothing when the vault and board already agree (active and open)', async () => {
    // Given — an active project whose board is open
    const { action, port, vault, syncState } = setup();
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));

    // When — the consistent state is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      archived: false,
      closed: false,
      syncedAt,
    });

    // Then — nothing is written
    expect(port.closedCalls).toEqual([]);
    expect(vault.moveCalls).toEqual([]);
    expect(syncState.saved).toEqual([]);
  });

  it('is idempotent: a second pass over the settled state writes nothing', async () => {
    // Given — a project that has just been archived
    const { action, port, vault, syncState } = setup();
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));
    await action.execute({
      projectName: 'Acme Widgets',
      archived: true,
      closed: false,
      syncedAt,
    });

    // When — the next tick sees the settled state (archived and closed)
    await action.execute({
      projectName: 'Acme Widgets',
      archived: true,
      closed: true,
      syncedAt,
    });

    // Then — the first pass's writes stand and nothing more is written
    expect(port.closedCalls).toHaveLength(1);
    expect(vault.moveCalls).toHaveLength(1);
    expect(syncState.saved).toHaveLength(1);
  });

  it('is idempotent: a repeated pass performs no folder or Status writes', async () => {
    // Given — a project that has just been archived
    const { action, vault, syncState } = setup();
    vault.paths.add(taskPath);
    syncState.records.push(record(taskPath));
    await action.execute({
      projectName: 'Acme Widgets',
      archived: true,
      closed: false,
      syncedAt,
    });
    const moves = vault.renames.length;
    const saves = syncState.saved.length;

    // When — the same mismatch is reconciled again
    await action.execute({
      projectName: 'Acme Widgets',
      archived: true,
      closed: false,
      syncedAt,
    });

    // Then — the move and the relocation are no-ops on already-correct state
    expect(vault.renames).toHaveLength(moves);
    expect(syncState.saved).toHaveLength(saves);
  });

  it('skips a project with no stored identity', async () => {
    // Given — a project whose identity was never persisted
    const { action, port, vault, syncState } = setup();
    syncState.identity = null;
    vault.paths.add(taskPath);

    // When — the mismatch is reconciled
    await action.execute({
      projectName: 'Acme Widgets',
      archived: true,
      closed: false,
      syncedAt,
    });

    // Then — nothing is written
    expect(port.closedCalls).toEqual([]);
    expect(vault.moveCalls).toEqual([]);
  });
});
