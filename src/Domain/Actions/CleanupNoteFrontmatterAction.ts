import type { VaultPort } from '../Ports/VaultPort.js';

export interface CleanupNoteFrontmatterInput {
  projectName: string;
}

// Strips the legacy machine-id frontmatter fields from every task and to-do
// note: `id:` (the vault-owned uuid that moved into the registry, dt-20) and
// `url:` (the old mirror address the registry now owns). A `todoist:` anchor is
// left as-is — it is not a machine id and the project note still uses one.
// Idempotent: a note carrying neither field is left untouched. Runs at chain
// start, per project, before any half reads notes.
export class CleanupNoteFrontmatterAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(input: CleanupNoteFrontmatterInput): Promise<void> {
    const folders = [
      `Projecten/${input.projectName}/taken`,
      `Projecten/${input.projectName}/todos`,
    ];

    for (const folder of folders) {
      for (const path of await this.vault.listNotesInFolder(folder)) {
        await this.clean(path);
      }
    }
  }

  // A note that cannot be parsed carries no frontmatter block to clean; it is
  // skipped rather than rewritten, so a malformed note is never damaged.
  private async clean(path: string): Promise<void> {
    const note = await this.vault.getNoteByPath(path);
    if (note === null) {
      return;
    }
    const lines = note.content.split('\n');
    if (lines[0] !== '---') {
      return;
    }
    const closing = lines.indexOf('---', 1);
    if (closing === -1) {
      return;
    }
    const block = lines.slice(0, closing + 1);
    const cleaned = block.filter(
      (line, index) =>
        index === 0 ||
        (!line.startsWith('id:') && !line.startsWith('url:')),
    );
    if (cleaned.length === block.length) {
      return;
    }
    await this.vault.writeNote(
      path,
      [...cleaned, ...lines.slice(closing + 1)].join('\n'),
    );
  }
}
