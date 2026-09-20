import { stateFromStatus } from '../Board/stateFromStatus.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { BoardStatusAction } from './BoardStatusAction.js';

export interface PropagateStatusInput {
  url: string;
  // The project's Status option name the note now carries.
  statusName: string;
  notePath: string;
  projectName: string;
}

// UC6/UC7: propagate a task note's status onto its GitHub issue and mirror it
// onto the board. The done lane closes the issue, every other lane reopens
// it; the card moves to the lane the note carries. The Status record is
// refreshed so the baseline tracks the new lane (the echo guard depends on
// every write refreshing the full record).
export class PropagateStatusAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly boardStatus: BoardStatusAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: PropagateStatusInput): Promise<void> {
    const updated = await this.projectManagement.setTaskState(
      input.url,
      stateFromStatus(input.statusName, this.doneOptionName),
    );

    await this.boardStatus.execute({
      projectName: input.projectName,
      url: input.url,
      statusName: input.statusName,
    });

    const status = await this.syncState.get(input.url);
    if (!status) {
      return;
    }

    await this.syncState.set({
      url: status.url,
      remoteId: status.remoteId,
      notePath: input.notePath,
      lastSyncedBodyHash: status.lastSyncedBodyHash,
      lastSyncedRemoteUpdatedAt: updated.updatedAt,
      lastSyncedStatus: input.statusName,
      lastSyncedTitle: status.lastSyncedTitle,
    });
  }
}
