import { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import { DomainError } from '../shared/DomainError.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import { deriveBoardChoice } from './deriveBoardChoice.js';
import { repoNameFromUrl } from './repoNameFromUrl.js';

// The discovery input: one identifier per connection — the repository url. The
// board is no longer configured; it is derived from the repo.
export interface AttachProjectInput {
  repoUrl: string;
}

// UC1: attach a project. Resolves a project note's code-host connection to its
// identities from the repository alone. A github connection without a repo url
// is a config error. The board is derived by the same ladder the sync chain
// uses: no board yet resolves the repo alone (the chain's ensure-board step
// creates it), one board is adopted, several adopt the one titled with the repo
// name, and several with no title match is a discovery error the user resolves
// once.
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
      // No board yet: discovery resolves the repository alone and never writes.
      // The sync chain's ensure-board step creates the board on the next pass.
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
