import type { AttachProjectAction } from './AttachProjectAction.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { VaultPort } from '../Ports/VaultPort.js';

// A project discovered in the vault: its name (from the note path) and the
// GitHub identities it resolves to.
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
// project notes, attaches each github one to resolve its identities, skips
// providers this plugin does not handle, and collects (rather than aborts on)
// any note that fails to attach.
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
      try {
        const identity = await this.attachProject.execute({
          pm: note.pm,
          repoUrl: note.url,
          boardUrl: note.board,
        });
        if (identity) {
          projects.push({
            projectName: note.projectName,
            identity: { ...identity, repoUrl: note.url },
          });
        }
      } catch (error) {
        errors.push(error);
      }
    }

    return { projects, errors };
  }
}
