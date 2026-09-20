import { stateFromStatus } from '../Board/stateFromStatus.js';
import { withStatus } from '../Notes/TaskNoteParser.js';
import { hash } from '../Notes/hash.js';
import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { Status } from '../Models/Status.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface ApplyBoardChangeInput {
  projectName: string;
  item: BoardItemData;
  syncedAt: string;
}

// UC8: a board-driven status change. The board's lane is leading: the card's
// Status option name becomes the note's status verbatim, and the issue state
// follows the lane's done-ness (the done lane closes the issue, every other
// lane reopens it) — but only when done-ness actually changes; a move between
// non-done lanes never touches the issue. Draft cards, cards with no Status
// value, and untracked issues are skipped.
export class ApplyBoardChangeAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly vault: VaultPort,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: ApplyBoardChangeInput): Promise<void> {
    const { item } = input;
    if (!item.issueUrl || item.statusOptionName === undefined) {
      return;
    }

    const status = await this.syncState.get(item.issueUrl);
    if (!status) {
      return;
    }

    // Already in step — the baseline tracks this lane.
    if (status.lastSyncedStatus === item.statusOptionName) {
      return;
    }

    const wantedState = stateFromStatus(
      item.statusOptionName,
      this.doneOptionName,
    );
    const currentState = stateFromStatus(
      status.lastSyncedStatus,
      this.doneOptionName,
    );

    if (wantedState !== currentState) {
      const updated = await this.projectManagement.setTaskState(
        item.issueUrl,
        wantedState,
      );
      await this.applyLane(status, item.statusOptionName, updated);
    } else {
      // A move between non-done lanes: the note follows the lane, the issue
      // is untouched, and the baseline keeps its remote timestamps.
      await this.applyLane(status, item.statusOptionName);
    }
  }

  // Rewrites just the note's status line and refreshes the baseline so the
  // note and the baseline agree on the new lane without clobbering the body.
  // When the issue state changed, the baseline refreshes from the
  // state-change response; otherwise it keeps the recorded remote fields.
  private async applyLane(
    status: Status,
    statusName: string,
    updated?: TaskData,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(status.notePath);
    if (note) {
      await this.vault.writeNote(
        status.notePath,
        withStatus(note.content, statusName),
      );
    }

    await this.syncState.set({
      url: status.url,
      remoteId: status.remoteId,
      notePath: status.notePath,
      lastSyncedBodyHash: updated ? hash(updated.body) : status.lastSyncedBodyHash,
      lastSyncedRemoteUpdatedAt: updated
        ? updated.updatedAt
        : status.lastSyncedRemoteUpdatedAt,
      lastSyncedStatus: statusName,
      lastSyncedTitle: updated ? updated.title : status.lastSyncedTitle,
    });
  }
}
