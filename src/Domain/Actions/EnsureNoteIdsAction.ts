import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stampFrontmatterField } from '../Notes/stampFrontmatterField.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface EnsureNoteIdsInput {
  projectName: string;
}

// Backfills the vault-owned uuid into every task and to-do note's frontmatter
// (`id:` field). Idempotent: a note that already carries an id is left
// untouched. Runs at chain start, per project, before any half reads notes.
//
// WHY the id lives in frontmatter: the note resolves to its registry record.
// The registry's byNotePath index is the primary lookup — the path is what a
// read has in hand — but the frontmatter id is the durable anchor: it survives
// the loss of the registry store (the note can be re-registered) and detects
// duplicated notes (two notes claiming one id). Without it a registry wipe
// would silently orphan every mirror.
export class EnsureNoteIdsAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(input: EnsureNoteIdsInput): Promise<void> {
    const folders = [
      `Projecten/${input.projectName}/taken`,
      `Projecten/${input.projectName}/todos`,
    ];

    for (const folder of folders) {
      for (const path of await this.vault.listNotesInFolder(folder)) {
        await this.stamp(path);
      }
    }
  }

  // A note that cannot be parsed carries no frontmatter to stamp into; it is
  // skipped rather than rewritten, so a malformed note is never damaged.
  private async stamp(path: string): Promise<void> {
    const note = await this.vault.getNoteByPath(path);
    if (note === null) {
      return;
    }
    const parsed = splitFrontmatter(note.content);
    if (parsed === null || parsed.fields.has('id')) {
      return;
    }
    await stampFrontmatterField(
      this.vault,
      path,
      note.content,
      'id',
      crypto.randomUUID(),
    );
  }
}
