import type { ProjectBoardData } from '../shared/ProjectBoardData.js';
import type { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { RepoBoardData } from '../shared/RepoBoardData.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import { deriveBoardChoice } from './deriveBoardChoice.js';
import { repoNameFromUrl } from './repoNameFromUrl.js';

export interface EnsureProjectBoardInput {
  projectName: string;
}

// UC: complete PRJ-1's vault -> code-host leg, now that the board is DERIVED
// from the repository rather than configured. A project whose identity has no
// board yet gains one by the derivation ladder, keyed on the REPOSITORY NAME
// (parsed from the connection's repo url), never the vault project name:
//
//   - no board linked to the repo -> create one titled with the repo name,
//     link it to the repo, and give it a Status field with the configured
//     options;
//   - exactly one -> adopt it, re-resolving its field ids;
//   - several -> adopt the one titled with the repo name; no title match is a
//     discovery error the user resolves once (nothing is created or adopted
//     silently).
//
// The action is a no-op once the identity carries a board node id, so a settled
// project never re-creates one (PRJ-1 idempotency). A project with no repo url
// has nothing to derive from and is left board-less until a repo is attached.
// The action never touches frontmatter: the board is re-derived from the repo
// on registry loss, so no `board:` anchor is read or stamped.
export class EnsureProjectBoardAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly statusOptions: string[],
  ) {}

  async execute(input: EnsureProjectBoardInput): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    if (identity?.projectNodeId) {
      return;
    }

    const repoUrl = identity?.repoUrl ?? '';
    if (repoUrl === '') {
      // The board is derived from the repository; with no repository there is
      // nothing to derive from. A repo-less project stays board-less until one
      // is attached.
      return;
    }

    const repoName = repoNameFromUrl(repoUrl);
    const { repoNodeId, boards } =
      await this.projectManagement.fetchRepoBoards(repoUrl);
    const choice = deriveBoardChoice(repoName, boards);
    if (choice.kind === 'ambiguous') {
      throw new Error(
        `EnsureProjectBoardAction: repository ${repoUrl} has several boards and none is titled "${repoName}"; not creating or adopting one`,
      );
    }

    const board =
      choice.kind === 'create'
        ? await this.projectManagement.createBoardWithStatusField(
            repoUrl,
            this.statusOptions,
          )
        : await this.adopt(choice.board, repoUrl);

    const merged: ProjectIdentityData = {
      repoUrl,
      repoNodeId,
      projectNodeId: board.projectNodeId,
      statusFieldId: board.statusFieldId,
      statusOptions: board.statusOptions,
    };
    await this.syncState.setIdentity(input.projectName, merged);
  }

  // Re-resolves an adopted board's field ids through the identity read, so the
  // registry stores live addressing rather than a stale listing's.
  private async adopt(
    board: RepoBoardData,
    repoUrl: string,
  ): Promise<ProjectBoardData> {
    const resolved = await this.projectManagement.fetchProjectIdentity({
      pm: 'github',
      repoUrl,
      boardUrl: board.boardUrl,
    });
    if (resolved === null) {
      throw new Error(
        `EnsureProjectBoardAction: board ${board.boardUrl} could not be resolved`,
      );
    }
    return {
      projectNodeId: resolved.projectNodeId,
      boardUrl: board.boardUrl,
      statusFieldId: resolved.statusFieldId,
      statusOptions: resolved.statusOptions,
    };
  }
}
