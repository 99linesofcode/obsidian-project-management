import { noteId, stampNoteId } from '../../domain/noteIdentity.js';
import type { VaultPort } from '../../port/VaultPort.js';

export interface MigrateNoteIdsInput {
  projectName: string;
}

export class MigrateNoteIdsAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(input: MigrateNoteIdsInput): Promise<void> {
    for (const root of ['Projecten', 'Archief']) {
      for (const path of await this.vault.listNotesInFolder(
        `${root}/${input.projectName}`,
      )) {
        await this.stampMissingId(path);
      }
    }
  }

  private async stampMissingId(path: string): Promise<void> {
    const note = await this.vault.getNoteByPath(path);
    if (note === null || noteId(note.content) !== null) {
      return;
    }
    await this.vault.writeNote(
      path,
      stampNoteId(note.content, crypto.randomUUID()),
    );
  }
}
