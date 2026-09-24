import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface ReconcileArchiveStateInput {
  projectName: string;
  archived: boolean;
  closed: boolean;
  syncedAt: string;
}

// UC: reconcile a project's vault location with its GitHub board state. The
// note's location is the archived flag (derived fresh each tick); the probe's
// closed flag is the remote state. A mismatch means one side moved, and the
// vault wins: the board is closed/opened and the folder is moved to match. The
// move fires per-file rename events that the rename route follows
// incrementally; the bulk Status relocation is the catch-all for anything the
// events miss. Both are no-ops on already-correct state, so a settled project
// writes nothing.
export class ReconcileArchiveStateAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: ReconcileArchiveStateInput): Promise<void> {
    if (input.archived === input.closed) {
      return;
    }
    const identity = await this.syncState.getIdentity(input.projectName);
    if (!identity?.projectNodeId) {
      return;
    }
    if (input.archived) {
      await this.archive(input.projectName, identity.projectNodeId);
    } else {
      await this.unarchive(input.projectName, identity.projectNodeId);
    }
  }

  private async archive(
    projectName: string,
    projectNodeId: string,
  ): Promise<void> {
    await this.projectManagement.setProjectClosed(projectNodeId, true);
    await this.vault.moveFolder(
      `Projecten/${projectName}`,
      `Archief/${projectName}`,
    );
    await this.relocateStatuses(
      `Projecten/${projectName}/`,
      `Archief/${projectName}/`,
    );
  }

  private async unarchive(
    projectName: string,
    projectNodeId: string,
  ): Promise<void> {
    await this.vault.moveFolder(
      `Archief/${projectName}`,
      `Projecten/${projectName}`,
    );
    await this.projectManagement.setProjectClosed(projectNodeId, false);
    await this.relocateStatuses(
      `Archief/${projectName}/`,
      `Projecten/${projectName}/`,
    );
  }

  private async relocateStatuses(
    fromPrefix: string,
    toPrefix: string,
  ): Promise<void> {
    for (const status of await this.syncState.list()) {
      if (status.notePath.startsWith(fromPrefix)) {
        await this.syncState.set({
          ...status,
          notePath: `${toPrefix}${status.notePath.slice(fromPrefix.length)}`,
        });
      }
    }
  }
}
