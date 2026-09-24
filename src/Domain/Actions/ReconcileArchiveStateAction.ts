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
export class ReconcileArchiveStateAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
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
    await this.syncState.setArchiveBaseline(input.projectName, {
      locationArchived: reconciledLocation,
      closed: reconciledLocation,
    });
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
