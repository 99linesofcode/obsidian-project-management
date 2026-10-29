import { noteId, stampNoteId } from '../../domain/noteIdentity.js';
import { rewriteFrontmatterFields } from '../../domain/note.js';
import { resolveHomeNotePath } from '../../domain/paths.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';

export interface MigrateNoteIdsInput {
  projectName: string;
}

const ROOTS = ['Projecten', 'Archief'] as const;

export class MigrateNoteIdsAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: RegistryPort,
  ) {}

  async execute(input: MigrateNoteIdsInput): Promise<void> {
    await this.rekeyLegacyProject(input.projectName);

    for (const root of ROOTS) {
      for (const path of await this.vault.listNotesInFolder(
        `${root}/${input.projectName}`,
      )) {
        await this.migrateNote(path);
      }
    }
  }

  private async rekeyLegacyProject(projectName: string): Promise<void> {
    const homePath = await this.homeNotePath(projectName);
    if (homePath === null) {
      return;
    }
    await this.migrateNote(homePath);
    const note = await this.vault.getNoteByPath(homePath);
    const projectId = note === null ? null : noteId(note.content);
    if (projectId !== null) {
      await this.syncState.rekeyProject(projectName, projectId);
    }
  }

  private async homeNotePath(projectName: string): Promise<string | null> {
    const paths: string[] = [];
    for (const root of ROOTS) {
      paths.push(
        ...(await this.vault.listNotesInFolder(`${root}/${projectName}`)),
      );
    }
    return resolveHomeNotePath(paths, projectName);
  }

  private async migrateNote(path: string): Promise<void> {
    const note = await this.vault.getNoteByPath(path);
    if (note === null) {
      return;
    }
    const withoutName = rewriteFrontmatterFields(
      note.content,
      new Map([['name', null]]),
    );
    const id = noteId(withoutName);
    const migrated =
      id === null
        ? stampNoteId(
            withoutName,
            (await this.syncState.findByNotePath(path))?.id ??
              crypto.randomUUID(),
          )
        : withoutName;
    if (migrated !== note.content) {
      await this.vault.writeNote(path, migrated);
    }
  }
}
