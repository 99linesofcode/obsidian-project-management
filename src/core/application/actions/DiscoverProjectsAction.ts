import type { AttachProjectAction } from './AttachProjectAction.js';
import type { ProjectSetupFactoryPort } from '../../port/ProjectSetupFactoryPort.js';
import type { ProjectIdentityDataTransferObject } from '../data/ProjectIdentityDataTransferObject.js';
import type { NoteEnumeratorPort } from '../../port/NoteEnumeratorPort.js';

export interface DiscoveredProject {
  projectName: string;
  connectionSlug: string;
  identity: ProjectIdentityDataTransferObject;
}

export interface DiscoveryResult {
  projects: DiscoveredProject[];
  errors: unknown[];
}

export class DiscoverProjectsAction {
  constructor(
    private readonly vault: NoteEnumeratorPort,
    private readonly setupFactory: ProjectSetupFactoryPort,
    private readonly attachProject: AttachProjectAction,
  ) {}

  async execute(): Promise<DiscoveryResult> {
    const notes = await this.vault.findProjectNotes();

    const projects: DiscoveredProject[] = [];
    const errors: unknown[] = [];

    for (const note of notes) {
      errors.push(...note.connectionErrors);
      for (const connection of note.connections) {
        const setup = this.setupFactory.setupFor(connection.application);
        if (setup === null) {
          continue;
        }
        try {
          const identity = await this.attachProject.execute({
            repoUrl: connection.target,
            setup,
          });
          projects.push({
            projectName: note.projectName,
            connectionSlug: connection.slug,
            identity: { ...identity, repoUrl: connection.target },
          });
        } catch (error) {
          errors.push(error);
        }
      }
    }

    return { projects, errors };
  }
}
