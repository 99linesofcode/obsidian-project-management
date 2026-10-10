import { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import { DomainError } from '../shared/DomainError.js';
import type { ProjectSetupPort } from '../core/ports/ProjectSetupPort.js';
import { deriveBoardChoice } from './deriveBoardChoice.js';
import { repoNameFromUrl } from './repoNameFromUrl.js';

export interface AttachProjectInput {
  repoUrl: string;
}

export class AttachProjectAction {
  constructor(private readonly setup: ProjectSetupPort) {}

  async execute(data: AttachProjectInput): Promise<ProjectIdentityData> {
    if (!data.repoUrl) {
      throw new DomainError(
        'AttachProjectAction: repoUrl is required on a github connection',
      );
    }

    const repoName = repoNameFromUrl(data.repoUrl);
    const discovery = await this.setup.discoverProjects(data.repoUrl);
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

    const addressing = await this.setup.readProjectAddressing(choice.board);
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
