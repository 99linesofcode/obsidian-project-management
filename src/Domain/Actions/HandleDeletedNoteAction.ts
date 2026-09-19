import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';

export interface HandleDeletedNoteInput {
  notePath: string;
}

// UC6: close a task's GitHub issue when its note is deleted. The note is gone,
// so the Status record is found by its path; an untracked file (no record) is
// a no-op. Obsidian deletes go to .trash; v1 closes the issue on the delete
// event and does not reopen on restore (agreed 2026-09-18).
export class HandleDeletedNoteAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
  ) {}

  async execute(input: HandleDeletedNoteInput): Promise<void> {
    const status = await this.syncState.findByNotePath(input.notePath);
    if (!status) {
      return;
    }

    await this.projectManagement.setTaskState(status.url, 'closed');
    await this.syncState.remove(status.url);
  }
}
