import type { AttachProjectAction } from './AttachProjectAction.js';
import type { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { VaultPort } from '../shared/VaultPort.js';

// A project discovered in the vault: its name (from the note path), the
// connection slug the identity belongs to, and the code-host identity it
// resolves to.
export interface DiscoveredProject {
  projectName: string;
  connectionSlug: string;
  identity: ProjectIdentityData;
}

// The outcome of discovery: the projects that resolved successfully and the
// errors from notes that could not be attached. One broken note does not
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
// attach errors. A read: the re-key of a renamed connection is a separate
// action.
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
