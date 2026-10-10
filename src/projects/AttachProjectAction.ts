import { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import { DomainError } from '../shared/DomainError.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import { deriveBoardChoice } from './deriveBoardChoice.js';
import { repoNameFromUrl } from './repoNameFromUrl.js';

export interface AttachProjectInput {
  repoUrl: string;
}

export class AttachProjectAction {
  constructor(private readonly port: ProjectManagementPort) {}

  async execute(data: AttachProjectInput): Promise<ProjectIdentityData> {
    if (!data.repoUrl) {
      throw new DomainError(
        'AttachProjectAction: repoUrl is required on a github connection',
      );
    }

    const repoName = repoNameFromUrl(data.repoUrl);
    const { repoNodeId, boards } = await this.port.fetchRepoBoards(
      data.repoUrl,
    );
    const choice = deriveBoardChoice(repoName, boards);
    if (choice.kind === 'ambiguous') {
      throw new DomainError(
        `AttachProjectAction: repository ${data.repoUrl} has several boards and none is titled "${repoName}"`,
      );
    }
    if (choice.kind === 'create') {
      return new ProjectIdentityData({
        repoUrl: data.repoUrl,
        repoNodeId,
        projectNodeId: '',
        statusFieldId: '',
        statusOptions: [],
      });
    }

    const identity = await this.port.fetchProjectIdentity({
      repoUrl: data.repoUrl,
      boardUrl: choice.board.boardUrl,
    });
    if (identity === null) {
      throw new DomainError(
        `AttachProjectAction: board ${choice.board.boardUrl} could not be resolved`,
      );
    }
    return identity;
  }
}
