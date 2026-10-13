import { projectFromNotePath, projectHomePath, projectPathWithName } from '../../domain/paths.js';
import { hasTopLevelFrontmatterField, rewriteFrontmatterFields } from '../../domain/note.js';
import type { VaultPort } from '../../port/VaultPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';

export interface RenameProjectInput {
  projectName: string;
  notePath: string;
  locationArchived: boolean;
}

// Reconciles a project note's declared name with the folder it sits in: a note
// with no `project` property adopts the folder segment once; a folder that
// disagrees with the property is renamed to match — the home note and the rest
// of the folder within the project's current root — and the registry's project
// node is re-keyed to the new name. A folder renamed directly, where the
// registry already files the declared name, is renamed back and reported.
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
    if (folderName === input.projectName) {
      return [];
    }
    const folderDrift = await this.syncState.hasProject(input.projectName);
    await this.renameNotes(input, folderName);
    await this.syncState.rekeyProject(folderName, input.projectName);
    return folderDrift ? [folderDriftWarning(input, folderName)] : [];
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
