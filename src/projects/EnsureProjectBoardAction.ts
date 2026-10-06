import { stampFrontmatterField } from '../vault/stampFrontmatterField.js';
import type { ProjectBoardData } from './ProjectBoardData.js';
import type { ProjectIdentityData } from './ProjectIdentityData.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';

export interface EnsureProjectBoardInput {
  projectName: string;
  notePath: string;
}

// UC: complete PRJ-1's vault -> code-host leg. A vault project whose identity has
// no board yet gains one: a ProjectV2 board is created under the token's
// viewer and its node id, Status field and option ids are stored in the
// project identity, so the probe and the code host half can address it from the
// next read. The board's url is stamped onto the home note (the `board:`
// anchor) so discovery can re-resolve the identity after a registry loss.
//
// Repo attachment is deliberately NOT part of this act (ATT-1 owns it). A
// board without a repository materializes no issues — the code host half skips a
// project whose identity has no repo url — which is correct until the user
// attaches one.
//
// Creation is guarded by a same-name lookup: a crash between `createProject`
// and the identity write would otherwise orphan a board that the next pass
// duplicates. A board of the same name is ADOPTED (its addressing re-resolved
// through fetchProjectIdentity); only an absent board is created.
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

    const board = await this.resolveBoard(input.projectName);
    if (board === null) {
      // A same-name board exists but its addressing could not be resolved.
      // Creating a second board would duplicate it, so leave it for the next
      // pass rather than guessing.
      console.error(
        `EnsureProjectBoardAction: a board named "${input.projectName}" exists but its identity could not be resolved; not creating a duplicate`,
      );
      return;
    }

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

  // Adopts a same-name viewer board when one exists, otherwise creates a fresh
  // board. WHY the lookup first: an interrupted creation (the board exists, the
  // identity write did not) must heal by adopting the orphan, never by creating
  // a duplicate. A same-name board whose addressing cannot be resolved yields
  // null so the caller creates nothing.
  private async resolveBoard(name: string): Promise<ProjectBoardData | null> {
    const boards = await this.projectManagement.fetchViewerProjects();
    const existing = boards.find((board) => board.name === name);
    if (existing === undefined) {
      return this.projectManagement.createProject(name);
    }
    const boardUrl = existing.mirrors.github ?? '';
    if (boardUrl === '') {
      return null;
    }
    const resolved = await this.projectManagement.fetchProjectIdentity({
      pm: 'github',
      repoUrl: '',
      boardUrl,
    });
    if (resolved === null) {
      return null;
    }
    return {
      projectNodeId: resolved.projectNodeId,
      boardUrl,
      statusFieldId: resolved.statusFieldId,
      statusOptions: resolved.statusOptions,
    };
  }
}
