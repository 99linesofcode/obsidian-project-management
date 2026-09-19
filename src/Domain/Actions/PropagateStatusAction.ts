import { TaskStatus, taskStatusFromState } from '../Enums/TaskStatus.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';

export interface PropagateStatusInput {
  url: string;
  status: TaskStatus;
  notePath: string;
}

// UC6: propagate a task note's status onto its GitHub issue. A done note
// closes the issue; an open note reopens it. The Status record is refreshed
// from the PATCH response so the baseline tracks the new remote state (the
// echo guard depends on every write refreshing the full record).
export class PropagateStatusAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: PropagateStatusInput): Promise<void> {
    const updated = await this.projectManagement.setTaskState(
      input.url,
      input.status === TaskStatus.Done ? 'closed' : 'open',
    );

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
      lastSyncedStatus: taskStatusFromState(updated.state),
      lastSyncedTitle: status.lastSyncedTitle,
    });
  }
}
