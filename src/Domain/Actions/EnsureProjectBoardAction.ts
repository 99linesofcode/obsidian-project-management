import { stampFrontmatterField } from '../Notes/stampFrontmatterField.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface EnsureProjectBoardInput {
  projectName: string;
  notePath: string;
}

// UC: complete PRJ-1's vault -> GitHub leg. A vault project whose identity has
// no board yet gains one: a ProjectV2 board is created under the token's
// viewer and its node id, Status field and option ids are stored in the
// project identity, so the probe and the GitHub half can address it from the
// next read. The board's url is stamped onto the home note (the `board:`
// anchor) so discovery can re-resolve the identity after a registry loss.
//
// Repo attachment is deliberately NOT part of this act (ATT-1 owns it). A
// board without a repository materializes no issues — the GitHub half skips a
// project whose identity has no repo url — which is correct until the user
// attaches one.
//
// The action is a no-op once the identity carries a board node id, so a
// settled project never re-creates one (PRJ-1 idempotency). It is a separate
// step rather than lifecycle-inline because the lifecycle's archive merge is
// not the right place to decide board creation: this step only runs for an
// active project (the chain guards the archived case), so a project that is
// about to freeze never spawns a board just to close it.
export class EnsureProjectBoardAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: EnsureProjectBoardInput): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    if (identity?.projectNodeId) {
      return;
    }

    const board = await this.projectManagement.createProject(input.projectName);
    const merged: ProjectIdentityData = {
      repoUrl: identity?.repoUrl ?? '',
      repoNodeId: identity?.repoNodeId ?? '',
      projectNodeId: board.projectNodeId,
      statusFieldId: board.statusFieldId,
      statusOptions: board.statusOptions,
    };
    await this.syncState.setIdentity(input.projectName, merged);

    // Re-read the note: the lifecycle may have stamped the todoist anchor
    // after the chain resolved it, so stamping from a stale read would drop it.
    const note = await this.vault.getNoteByPath(input.notePath);
    if (note !== null && board.boardUrl !== '') {
      await stampFrontmatterField(
        this.vault,
        input.notePath,
        note.content,
        'board',
        board.boardUrl,
      );
    }
  }
}
