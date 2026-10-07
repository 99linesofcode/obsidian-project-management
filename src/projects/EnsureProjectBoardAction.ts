import type { ProjectBoardData } from '../shared/ProjectBoardData.js';
import { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { RepoBoardData } from '../shared/RepoBoardData.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import { deriveBoardChoice } from './deriveBoardChoice.js';
import { repoNameFromUrl } from './repoNameFromUrl.js';

export interface EnsureProjectBoardInput {
  projectName: string;
  // The code-host connection whose identity this board belongs to.
  connectionSlug: string;
}

// UC: complete PRJ-1's vault -> code-host leg, now that the board is DERIVED
// from the repository rather than configured. A project whose identity has no
// board yet gains one by the derivation ladder, keyed on the REPOSITORY NAME
// (parsed from the connection's repo url), never the vault project name:
//
//   - no board linked to the repo -> adopt an unlinked same-name viewer board
//     (the orphan of an interrupted creation) when one exists, else create one
//     titled with the repo name, link it, and give it a Status field;
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
    const identity = await this.syncState.getIdentity(
      input.projectName,
      input.connectionSlug,
    );
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
        ? await this.createOrAdoptOrphan(repoUrl, repoName)
        : await this.adopt(choice.board, repoUrl);

    const merged = new ProjectIdentityData({
      repoUrl,
      repoNodeId,
      projectNodeId: board.projectNodeId,
      statusFieldId: board.statusFieldId,
      statusOptions: board.statusOptions,
    });
    await this.syncState.setIdentity(
      input.projectName,
      input.connectionSlug,
      merged,
    );
  }

  // A repo with no linked board: adopt the orphan of an interrupted creation
  // (a same-name viewer board linked to no repository) when one exists, so a
  // crash between create and link never duplicates the board. Otherwise create.
  private async createOrAdoptOrphan(
    repoUrl: string,
    repoName: string,
  ): Promise<ProjectBoardData> {
    const orphanUrl = await this.findOrphanBoard(repoName);
    if (orphanUrl === null) {
      return this.projectManagement.createBoardWithStatusField(
        repoUrl,
        this.statusOptions,
      );
    }
    return this.projectManagement.adoptBoard(
      orphanUrl,
      repoUrl,
      this.statusOptions,
    );
  }

  // The url of a same-name viewer board linked to no repository, or null. A
  // board linked to another repository is not an orphan and is left alone.
  private async findOrphanBoard(repoName: string): Promise<string | null> {
    const boards = await this.projectManagement.fetchViewerProjects();
    const orphan = boards.find(
      (board) =>
        board.project.name === repoName && board.repoUrls.length === 0,
    );
    const url = orphan?.project.mirrors.github ?? '';
    return url === '' ? null : url;
  }

  // Re-resolves an adopted board's field ids through the port, so the registry
  // stores live addressing rather than a stale listing's, and heals a board
  // whose Status field was never created.
  private async adopt(
    board: RepoBoardData,
    repoUrl: string,
  ): Promise<ProjectBoardData> {
    return this.projectManagement.adoptBoard(
      board.boardUrl,
      repoUrl,
      this.statusOptions,
    );
  }
}
