import type { AttachProjectAction } from './AttachProjectAction.js';
import type { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { VaultPort } from '../shared/VaultPort.js';

export interface DiscoveredProject {
  projectName: string;
  connectionSlug: string;
  identity: ProjectIdentityData;
}

export interface DiscoveryResult {
  projects: DiscoveredProject[];
  errors: unknown[];
}

export class DiscoverProjectsAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly attachProject: AttachProjectAction,
  ) {}

  async execute(): Promise<DiscoveryResult> {
    const notes = await this.vault.findProjectNotes();

    const projects: DiscoveredProject[] = [];
    const errors: unknown[] = [];

    for (const note of notes) {
      errors.push(...note.connectionErrors);
      for (const [slug, connection] of Object.entries(note.connections)) {
        if (connection.tool !== 'github') {
          continue;
        }
        try {
          const identity = await this.attachProject.execute({
            repoUrl: connection.project,
          });
          projects.push({
            projectName: note.projectName,
            connectionSlug: slug,
            identity: { ...identity, repoUrl: connection.project },
          });
        } catch (error) {
          errors.push(error);
        }
      }
    }

    return { projects, errors };
  }
}
