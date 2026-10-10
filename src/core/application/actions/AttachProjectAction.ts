import { ProjectIdentityData } from '../data/ProjectIdentityData.js';
import { DomainError } from '../../domain/errors/DomainError.js';
import type { ProjectSetupPort } from '../../port/ProjectSetupPort.js';
import { deriveBoardChoice } from '../../domain/deriveBoardChoice.js';
import { repoNameFromUrl } from '../../domain/repoNameFromUrl.js';

export interface AttachProjectInput {
  repoUrl: string;
  setup: ProjectSetupPort;
}

export class AttachProjectAction {
  async execute(data: AttachProjectInput): Promise<ProjectIdentityData> {
    if (!data.repoUrl) {
      throw new DomainError('AttachProjectAction: repoUrl is required');
    }

    const repoName = repoNameFromUrl(data.repoUrl);
    const discovery = await data.setup.discoverProjects(data.repoUrl);
    const choice = deriveBoardChoice(repoName, discovery.projects);
    if (choice.kind === 'ambiguous') {
      throw new DomainError(
        `AttachProjectAction: repository ${data.repoUrl} has several boards and none is titled "${repoName}"`,
      );
    }
    if (choice.kind === 'create') {
      return new ProjectIdentityData({
        repoUrl: data.repoUrl,
        repoNodeId: discovery.targetHandle,
        projectNodeId: '',
        statusFieldId: '',
        statusOptions: [],
      });
    }

    const addressing = await data.setup.readProjectAddressing(choice.board);
    if (addressing === null) {
      throw new DomainError(
        `AttachProjectAction: board ${choice.board.name} could not be resolved`,
      );
    }
    return new ProjectIdentityData({
      repoUrl: data.repoUrl,
      repoNodeId: discovery.targetHandle,
      projectNodeId: addressing.projectHandle,
      statusFieldId: addressing.statusFieldHandle,
      statusOptions: [...addressing.statusOptions],
    });
  }
}
