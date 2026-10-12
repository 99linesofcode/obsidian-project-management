import {
  labelsFromNote,
  removeFrontmatterFields,
  splitFrontmatter,
  withLabels,
} from '../../domain/note.js';
import type { VaultPort } from '../../port/VaultPort.js';

export interface MigrateLabelsInput {
  projectName: string;
}

export class MigrateLabelsAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(input: MigrateLabelsInput): Promise<void> {
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
  const type = splitFrontmatter(content)?.fields.get('type');
  if (type === undefined) {
    return content;
  }
  const label = `type:${type}`;
  const labels = labelsFromNote(content);
  const nextLabels = labels.includes(label) ? labels : [...labels, label];
  return removeFrontmatterFields(
    withLabels(content, nextLabels),
    new Set(['type']),
  );
}
