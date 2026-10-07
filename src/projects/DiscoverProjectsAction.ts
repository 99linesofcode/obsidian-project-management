import type { AttachProjectAction } from './AttachProjectAction.js';
import type { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { VaultPort } from '../shared/VaultPort.js';

// A project discovered in the vault: its name (from the note path) and the
// code-host identities it resolves to.
export interface DiscoveredProject {
  projectName: string;
  identity: ProjectIdentityData;
}

// The outcome of discovery: the projects that resolved successfully and the
// errors from notes that could not be attached, so one broken note does not
// silence the rest.
export interface DiscoveryResult {
  projects: DiscoveredProject[];
  errors: unknown[];
}

// UC: discover the vault's synced projects at startup. Enumerates the vault's
// project notes, attaches each github connection to resolve its identities,
// skips the task-manager connections (the lifecycle owns their anchor), and
// collects (rather than aborts on) any connection that fails to attach. The
// validation errors a note's connections carried are surfaced alongside the
// attach errors.
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
      for (const connection of Object.values(note.connections)) {
        if (connection.tool !== 'github') {
          continue;
        }
        try {
          const identity = await this.attachProject.execute({
            repoUrl: connection.project,
          });
          projects.push({
            projectName: note.projectName,
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
