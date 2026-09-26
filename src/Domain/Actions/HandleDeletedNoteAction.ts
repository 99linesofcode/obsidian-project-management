import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { BoardStatusAction } from './BoardStatusAction.js';

export interface HandleDeletedNoteInput {
  notePath: string;
  projectName: string;
}

// UC6/UC7: close a task's GitHub issue when its note is deleted, and mirror
// the done status onto the board. The note is gone, so the Status record is
// found by its path; an untracked file (no record) is a no-op. Obsidian
// deletes go to .trash; v1 closes the issue on the delete event and does not
// reopen on restore (agreed 2026-09-18).
export class HandleDeletedNoteAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly boardStatus: BoardStatusAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: HandleDeletedNoteInput): Promise<void> {
    const status = await this.syncState.findByNotePath(input.notePath);
    if (!status) {
      return;
    }

    // The record's lane already names the issue state: a note already in the
    // done lane leaves the issue closed, so the state write is skipped.
    if (status.status !== this.doneOptionName) {
      await this.projectManagement.setTaskState(status.url, 'closed');
    }
    await this.boardStatus.execute({
      projectName: input.projectName,
      url: status.url,
      statusName: this.doneOptionName,
    });
    await this.syncState.remove(status.url);
  }
}
