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
//
// The issue state write is GATED: the stored record's lane already names the
// issue's open/closed state, so a lane that does not flip done-ness is not
// re-written. The gate IS the diff — only a real state change reaches GitHub.
export class PropagateStatusAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly boardStatus: BoardStatusAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: PropagateStatusInput): Promise<void> {
    const status = await this.syncState.get(input.url);
    const next = stateFromStatus(input.statusName, this.doneOptionName);

    // No record: the note is untracked, so there is no baseline to compare
    // against and the state is written. A record whose stored lane already
    // implies the same state is skipped (the write would be a no-op).
    let updatedAt = status?.updatedAt ?? '';
    if (!status) {
      const updated = await this.projectManagement.setTaskState(
        input.url,
        next,
      );
      updatedAt = updated.updatedAt;
    } else if (stateFromStatus(status.status, this.doneOptionName) !== next) {
      const updated = await this.projectManagement.setTaskState(
        input.url,
        next,
      );
      updatedAt = updated.updatedAt;
    }

    await this.boardStatus.execute({
      projectName: input.projectName,
      url: input.url,
      statusName: input.statusName,
    });

    if (!status) {
      return;
    }

    await this.syncState.set({
      url: status.url,
      remoteId: status.remoteId,
      nodeId: status.nodeId,
      todoistId: status.todoistId,
      notePath: input.notePath,
      title: status.title,
      body: status.body,
      status: input.statusName,
      completed: input.statusName === this.doneOptionName,
      parent: status.parent,
      labels: status.labels,
      updatedAt,
    });
  }
}
