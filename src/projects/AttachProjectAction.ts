import type { AttachProjectData } from './AttachProjectData.js';
import type { ProjectIdentityData } from './ProjectIdentityData.js';
import { DomainError } from '../shared/DomainError.js';
import type { ProjectManagementPort } from '../github/ProjectManagementPort.js';

// UC1: attach a project. Resolves a project note's sync frontmatter to its
// GitHub identities. Skips providers this plugin does not handle; a note
// claiming pm: github without a board url is a config error.
export class AttachProjectAction {
  constructor(private readonly port: ProjectManagementPort) {}

  async execute(data: AttachProjectData): Promise<ProjectIdentityData | null> {
    if (data.pm !== 'github') {
      return null;
    }
    if (!data.boardUrl) {
      throw new DomainError(
        'AttachProjectAction: boardUrl is required on a note claiming pm: github',
      );
    }
    return this.port.fetchProjectIdentity(data);
  }
}
