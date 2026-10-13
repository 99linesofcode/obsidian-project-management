import {
  projectFromNotePath,
  projectHomePath,
  projectPathWithName,
} from '../../domain/paths.js';
import {
  hasTopLevelFrontmatterField,
  rewriteFrontmatterFields,
} from '../../domain/note.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { VaultPort } from '../../port/VaultPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';

export interface RenameProjectInput {
  projectName: string;
  notePath: string;
  locationArchived: boolean;
  connections: readonly ConnectionDataTransferObject[];
}

// Reconciles a project note's declared name with the name the registry recorded
// (the recorded key) and with the folder it sits in. A note with no `project`
// property adopts the folder segment once. When the property differs from the
// recorded key the project is renamed — the home note and the rest of the
// folder within the project's current root — and the registry's project node is
// re-keyed to the new name. When the property equals the recorded key but the
// folder differs, the folder is renamed back and reported.
export class RenameProjectAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: RegistryPort,
  ) {}

  async execute(input: RenameProjectInput): Promise<unknown[]> {
    const folderName = projectFromNotePath(input.notePath);
    if (folderName === '') {
      return [];
    }
    if (await this.adopt(input, folderName)) {
      return [];
    }

    const recordedName = await this.recordedName(input, folderName);
    if (recordedName === input.projectName) {
      if (folderName !== input.projectName) {
        await this.renameNotes(input, folderName);
        return [folderDriftWarning(input, folderName)];
      }
      return [];
    }

    if (folderName !== input.projectName) {
      await this.renameNotes(input, folderName);
    }
    if (recordedName !== null) {
      await this.syncState.rekeyProject(recordedName, input.projectName);
    }
    return [];
  }

  private async recordedName(
    input: RenameProjectInput,
    folderName: string,
  ): Promise<string | null> {
    const names = await this.syncState.listProjects();
    if (names.includes(input.projectName)) {
      return input.projectName;
    }
    if (names.includes(folderName)) {
      return folderName;
    }
    const matches: string[] = [];
    for (const name of names) {
      if (await this.holdsConnection(name, input.connections)) {
        matches.push(name);
      }
    }
    return matches.length === 1 ? matches[0]! : null;
  }

  private async holdsConnection(
    name: string,
    connections: readonly ConnectionDataTransferObject[],
  ): Promise<boolean> {
    for (const connection of connections) {
      const state = await this.syncState.getPortState(name, connection.slug);
      if (
        state !== null &&
        state.provider === connection.application &&
        (connection.target === '' || state.project === connection.target)
      ) {
        return true;
      }
    }
    return false;
  }

  private async adopt(
    input: RenameProjectInput,
    folderName: string,
  ): Promise<boolean> {
    const note = await this.vault.getNoteByPath(input.notePath);
    if (note === null || hasTopLevelFrontmatterField(note.content, 'project')) {
      return false;
    }
    const adopted = rewriteFrontmatterFields(
      note.content,
      new Map([['project', folderName]]),
      true,
    );
    if (adopted === note.content) {
      return false;
    }
    await this.vault.writeNote(input.notePath, adopted);
    return true;
  }

  private async renameNotes(
    input: RenameProjectInput,
    folderName: string,
  ): Promise<void> {
    const root = input.locationArchived ? 'Archief' : 'Projecten';
    const notes = await this.vault.listNotesInFolder(`${root}/${folderName}`);
    await this.vault.renameNote(
      input.notePath,
      projectHomePath(input.projectName, input.locationArchived),
    );
    for (const note of notes) {
      if (note === input.notePath) {
        continue;
      }
      await this.vault.renameNote(
        note,
        projectPathWithName(note, input.projectName),
      );
    }
  }
}

function folderDriftWarning(
  input: RenameProjectInput,
  folderName: string,
): Error {
  return new Error(
    `project "${input.projectName}" was found under the "${folderName}" folder; the folder was renamed back to match its "project" property`,
  );
}
