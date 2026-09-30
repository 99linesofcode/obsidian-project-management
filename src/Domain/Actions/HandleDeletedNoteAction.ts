import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';

export interface HandleDeletedNoteInput {
  notePath: string;
  projectName: string;
}

// UC6/UC7: a deleted task note is a true removal. The board card is deleted
// (GitHub's API has no issue deletion, so the issue itself is closed — close is
// the terminal state), then the registry record is removed. The note is gone,
// so the record is found by its path; an untracked file (no record) is a no-op.
// Obsidian deletes go to .trash; v1 closes the issue on the delete event and
// does not reopen on restore (agreed 2026-09-18).
//
// The mirrors' remote twins are swept by the deletion propagation, unchanged:
// this action removes the hub record and closes the GitHub side; the record's
// absence is what lets the Todoist propagation treat the twin as gone.
export class HandleDeletedNoteAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: HandleDeletedNoteInput): Promise<void> {
    const record = await this.syncState.findByNotePath(input.notePath);
    if (!record) {
      return;
    }

    // The github handle and base are port items now, not entity fields; the
    // deleted note's entity resolves them through the port listing.
    const github = await this.githubItem(record.id, input.projectName);
    const url = github?.handle ?? '';

    // The card goes first: a deleted note must leave no card behind. An issue
    // with no card is a no-op at the port; a board-less project has no identity
    // to resolve, and the issue is still closed below. A to-do-only entity has
    // no github mirror and skips the whole GitHub side.
    const identity = await this.syncState.getIdentity(input.projectName);
    if (identity && url !== '') {
      await this.projectManagement.deleteCard(identity.projectNodeId, url);
    }

    // The mirror base's lane already names the issue state: a note already in
    // the done lane leaves the issue closed, so the state write is skipped.
    const lane = github?.base?.status ?? '';
    if (url !== '' && lane !== this.doneOptionName) {
      await this.projectManagement.setTaskState(url, 'closed');
    }
    await this.syncState.removeEntity(record.id);
  }

  // The entity's github mirror item, or null when it has none.
  private async githubItem(
    entityId: string,
    projectName: string,
  ): Promise<{ handle: string; base: TaskData | null } | null> {
    for (const { handle, item } of await this.syncState.listMirrorItems(
      projectName,
      'github',
    )) {
      if (item.entityId === entityId) {
        return { handle, base: item.base };
      }
    }
    return null;
  }
}
