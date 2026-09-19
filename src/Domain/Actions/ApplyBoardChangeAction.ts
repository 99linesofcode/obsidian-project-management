import { statusFromBoardOption } from '../Board/boardStatus.js';
import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { taskStatusFromState } from '../Enums/TaskStatus.js';
import type { Status } from '../Models/Status.js';
import { withStatus } from '../Notes/TaskNoteParser.js';
import { hash } from '../Notes/hash.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface ApplyBoardChangeInput {
  projectName: string;
  item: BoardItemData;
  syncedAt: string;
}

// UC8: a board-driven status change. When a card's Status disagrees with its
// issue's state, the board wins: close/reopen the issue, flip the note's
// status line (a targeted rewrite that keeps the body), and refresh the
// baseline so the echo guard stays quiet. Draft cards, cards with no Status
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

    const boardStatus = statusFromBoardOption(this.doneOptionName, item.statusOptionName);
    const issueState = status.lastSyncedStatus;

    if (boardStatus === 'done' && issueState === 'open') {
      const updated = await this.projectManagement.setTaskState(item.issueUrl, 'closed');
      await this.flipNote(status, 'done', updated);
    } else if (boardStatus === 'open' && issueState === 'done') {
      const updated = await this.projectManagement.setTaskState(item.issueUrl, 'open');
      await this.flipNote(status, 'open', updated);
    }
  }

  // Rewrites just the note's status line and refreshes the baseline from the
  // state-change response, so the note and the baseline agree on the new
  // status without clobbering the body.
  private async flipNote(status: Status, newStatus: 'done' | 'open', updated: TaskData): Promise<void> {
    const note = await this.vault.getNoteByPath(status.notePath);
    if (note) {
      await this.vault.writeNote(status.notePath, withStatus(note.content, newStatus));
    }

    await this.syncState.set({
      url: status.url,
      remoteId: status.remoteId,
      notePath: status.notePath,
      lastSyncedBodyHash: hash(updated.body),
      lastSyncedRemoteUpdatedAt: updated.updatedAt,
      lastSyncedStatus: taskStatusFromState(updated.state),
      lastSyncedTitle: updated.title,
    });
  }
}
