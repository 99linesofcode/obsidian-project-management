import type { VaultPort } from '../../port/VaultPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { HandleDeletedNoteAction } from './HandleDeletedNoteAction.js';

export interface SweepDeletedNotesInput {
  projectName: string;
  connections: ReadonlyArray<{
    slug: string;
    application: string;
    target: string;
  }>;
}

export class SweepDeletedNotesAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: RegistryPort,
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
            connections: input.connections,
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
