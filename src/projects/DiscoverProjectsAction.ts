import type { AttachProjectAction } from './AttachProjectAction.js';
import type { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { ProjectNoteData } from '../shared/ProjectNoteData.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';

// A project discovered in the vault: its name (from the note path) and the
// code-host identities it resolves to.
export interface DiscoveredProject {
  projectName: string;
  identity: ProjectIdentityData;
}

// The outcome of discovery: the projects that resolved successfully, the
// errors from notes that could not be attached, and the warnings from
// connections whose sync state no longer has a matching connection. One broken
// note does not silence the rest.
export interface DiscoveryResult {
  projects: DiscoveredProject[];
  errors: unknown[];
  warnings: unknown[];
}

// UC: discover the vault's synced projects at startup. Enumerates the vault's
// project notes, re-keys a renamed connection's registry port in lockstep,
// attaches each github connection to resolve its identities, skips the
// task-manager connections (the lifecycle owns their anchor), and collects
// (rather than aborts on) any connection that fails to attach. The validation
// errors a note's connections carried are surfaced alongside the attach errors.
export class DiscoverProjectsAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly attachProject: AttachProjectAction,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(): Promise<DiscoveryResult> {
    const notes = await this.vault.findProjectNotes();

    const projects: DiscoveredProject[] = [];
    const errors: unknown[] = [];
    const warnings: unknown[] = [];

    for (const note of notes) {
      errors.push(...note.connectionErrors);
      await this.rekeyRenamedConnections(note, warnings);
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

    return { projects, errors, warnings };
  }

  // A connection slug is the human-facing id: renaming it re-keys the registry
  // port in lockstep, never disconnects it. A port whose tool + project now
  // lives under a different slug is moved to the new slug in one write. A port
  // whose slug disappeared with no matching connection is left in place and
  // surfaced as a warning — connection removal is an open design question, so
  // nothing is deleted.
  private async rekeyRenamedConnections(
    note: ProjectNoteData,
    warnings: unknown[],
  ): Promise<void> {
    const ports = await this.syncState.listPortStates(note.projectName);
    const matched = new Set<string>();
    for (const [slug, connection] of Object.entries(note.connections)) {
      const existing = ports.find(
        (port) =>
          port.slug !== slug &&
          port.state.provider === connection.tool &&
          port.state.project === connection.project,
      );
      if (existing !== undefined) {
        await this.syncState.rekeyPortState(
          note.projectName,
          existing.slug,
          slug,
        );
        matched.add(existing.slug);
      }
      matched.add(slug);
    }
    for (const port of ports) {
      if (!matched.has(port.slug)) {
        warnings.push(
          new Error(
            `connection "${port.slug}" in project "${note.projectName}" no longer has a matching connection; its sync state is left in place`,
          ),
        );
      }
    }
  }
}
