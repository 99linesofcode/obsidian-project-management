import type { Status } from '../Models/Status.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface ReconcileArchiveStateInput {
  projectName: string;
  locationArchived: boolean;
  closed: boolean;
  syncedAt: string;
}

// UC: reconcile a project's vault location with its GitHub board state through
// a three-way merge against the last tick's observation (the baseline). The
// baseline is what tells a vault gesture (the user moved the folder) apart from
// a board gesture (someone closed or reopened the board) — a state pair alone
// cannot. The vault is the source of truth: a location change wins and the
// board follows; a board-only change moves the folder to match. A first
// observation adopts the current pair without transitioning, so a project
// discovered mid-life never self-transitions. The baseline is stored only after
// a successful reconciliation, so a thrown run leaves the old baseline and the
// next tick retries.
//
// A genuine archive — the reconciled location is archived where the baseline
// was not — locks every tracked issue's conversation that is not yet shipped,
// after the vault move and Status relocation so a failure retries from a
// consistent place. The vault decides "shipped": a record whose last synced
// Status is the done lane stays unlocked. The lock pass runs before the
// baseline write, so a failed lock leaves the baseline unwritten and the next
// tick re-runs the whole reconciliation; re-locking is idempotent on GitHub.
export class ReconcileArchiveStateAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: ReconcileArchiveStateInput): Promise<void> {
    const baseline = await this.syncState.getArchiveBaseline(input.projectName);
    if (!baseline) {
      await this.adopt(input);
      return;
    }

    const locationChanged =
      input.locationArchived !== baseline.locationArchived;
    const boardChanged = input.closed !== baseline.closed;
    if (!locationChanged && !boardChanged) {
      return;
    }

    const identity = await this.syncState.getIdentity(input.projectName);
    if (!identity?.projectNodeId) {
      return;
    }

    if (locationChanged) {
      await this.projectManagement.setProjectClosed(
        identity.projectNodeId,
        input.locationArchived,
      );
    } else {
      await this.applyBoardToVault(input.projectName, input.closed);
    }

    const reconciledLocation = locationChanged
      ? input.locationArchived
      : input.closed;
    if (reconciledLocation && !baseline.locationArchived) {
      await this.lockUnshippedIssues(input.projectName);
    }

    await this.syncState.setArchiveBaseline(input.projectName, {
      locationArchived: reconciledLocation,
      closed: reconciledLocation,
    });
  }

  private async lockUnshippedIssues(projectName: string): Promise<void> {
    for (const status of await this.trackedIssues(projectName)) {
      if (status.lastSyncedStatus === this.doneOptionName) {
        continue;
      }
      const task = await this.projectManagement.fetchTask(status.url);
      await this.projectManagement.lockIssue(task.nodeId);
    }
  }

  private async trackedIssues(projectName: string): Promise<Status[]> {
    // Either prefix: the relocation may or may not have run for a record yet.
    const prefixes = [`Projecten/${projectName}/`, `Archief/${projectName}/`];
    return (await this.syncState.list()).filter((status) =>
      prefixes.some((prefix) => status.notePath.startsWith(prefix)),
    );
  }

  private async adopt(input: ReconcileArchiveStateInput): Promise<void> {
    await this.syncState.setArchiveBaseline(input.projectName, {
      locationArchived: input.locationArchived,
      closed: input.closed,
    });
  }

  private async applyBoardToVault(
    projectName: string,
    closed: boolean,
  ): Promise<void> {
    if (closed) {
      await this.vault.moveFolder(
        `Projecten/${projectName}`,
        `Archief/${projectName}`,
      );
      await this.relocateStatuses(
        `Projecten/${projectName}/`,
        `Archief/${projectName}/`,
      );
    } else {
      await this.vault.moveFolder(
        `Archief/${projectName}`,
        `Projecten/${projectName}`,
      );
      await this.relocateStatuses(
        `Archief/${projectName}/`,
        `Projecten/${projectName}/`,
      );
    }
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
