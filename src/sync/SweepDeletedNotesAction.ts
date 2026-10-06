import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';
import type { HandleDeletedNoteAction } from './HandleDeletedNoteAction.js';

export interface SweepDeletedNotesInput {
  projectName: string;
}

// The chain's deletion sweep: a registry entity whose note is gone is a
// deletion to propagate. Only records under the project's folder are swept —
// a record relocated to Archief belongs to the archive lifecycle, not to the
// active project's sweep. One note's failure is logged and the sweep continues,
// so a single bad deletion never starves the rest.
export class SweepDeletedNotesAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly handleDeletedNote: HandleDeletedNoteAction,
  ) {}

  async execute(input: SweepDeletedNotesInput): Promise<void> {
    const prefix = `Projecten/${input.projectName}/`;
    for (const record of await this.syncState.listEntities(input.projectName)) {
      if (!record.notePath.startsWith(prefix)) {
        continue;
      }
      if ((await this.vault.getNoteByPath(record.notePath)) === null) {
        try {
          await this.handleDeletedNote.execute({
            notePath: record.notePath,
            projectName: input.projectName,
          });
        } catch (error) {
          console.error(
            `SweepDeletedNotesAction: delete ${record.notePath} failed`,
            error,
          );
        }
      }
    }
  }
}
