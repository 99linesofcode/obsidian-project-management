import type { ProjectBoardData } from '../shared/ProjectBoardData.js';
import { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { RepoBoardData } from '../shared/RepoBoardData.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import { deriveBoardChoice } from './deriveBoardChoice.js';
import { repoNameFromUrl } from './repoNameFromUrl.js';

export interface EnsureProjectBoardInput {
  projectName: string;
  connectionSlug: string;
}

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

  private async findOrphanBoard(repoName: string): Promise<string | null> {
    const boards = await this.projectManagement.fetchViewerProjects();
    const orphan = boards.find(
      (board) => board.project.name === repoName && board.repoUrls.length === 0,
    );
    const url = orphan?.project.mirrors.github ?? '';
    return url === '' ? null : url;
  }

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
