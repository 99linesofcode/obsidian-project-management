import {
  hasTopLevelFrontmatterField,
  rewriteFrontmatterFields,
  topLevelFrontmatterField,
} from '../../domain/note.js';
import type { VaultPort } from '../../port/VaultPort.js';

export interface MigrateNameInput {
  projectName: string;
}

export class MigrateNameAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(input: MigrateNameInput): Promise<void> {
    for (const path of await this.vault.listNotesInFolder(
      `Projecten/${input.projectName}`,
    )) {
      const note = await this.vault.getNoteByPath(path);
      if (note === null) {
        continue;
      }
      const migrated = migrateNote(note.content);
      if (migrated !== note.content) {
        await this.vault.writeNote(path, migrated);
      }
    }
  }
}

function migrateNote(content: string): string {
  if (!hasTopLevelFrontmatterField(content, 'project')) {
    return content;
  }
  const values = new Map<string, string | null>();
  if (!hasTopLevelFrontmatterField(content, 'name')) {
    values.set('name', topLevelFrontmatterField(content, 'project') ?? '');
  }
  values.set('project', null);
  return rewriteFrontmatterFields(content, values, true);
}
