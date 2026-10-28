import { noteId, stampNoteId } from '../../domain/noteIdentity.js';
import { stemOf } from '../../domain/note.js';
import { projectHomeStem, projectNameFromPath } from '../../domain/paths.js';
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
        await this.stampMissingId(path);
      }
    }
  }

  private async rekeyLegacyProject(projectName: string): Promise<void> {
    const homePath = await this.homeNotePath(projectName);
    if (homePath === null) {
      return;
    }
    await this.stampMissingId(homePath);
    const note = await this.vault.getNoteByPath(homePath);
    const projectId = note === null ? null : noteId(note.content);
    if (projectId !== null) {
      await this.syncState.rekeyProject(projectName, projectId);
    }
  }

  private async homeNotePath(projectName: string): Promise<string | null> {
    const homeStem = projectHomeStem(projectName);
    for (const root of ROOTS) {
      for (const path of await this.vault.listNotesInFolder(
        `${root}/${projectName}`,
      )) {
        if (projectNameFromPath(path) !== null && stemOf(path) === homeStem) {
          return path;
        }
      }
    }
    return null;
  }

  private async stampMissingId(path: string): Promise<void> {
    const note = await this.vault.getNoteByPath(path);
    if (note === null || noteId(note.content) !== null) {
      return;
    }
    const record = await this.syncState.findByNotePath(path);
    await this.vault.writeNote(
      path,
      stampNoteId(note.content, record?.id ?? crypto.randomUUID()),
    );
  }
}
