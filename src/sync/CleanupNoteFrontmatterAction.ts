import type { VaultPort } from '../shared/VaultPort.js';

export interface CleanupNoteFrontmatterInput {
  projectName: string;
}

// Strips the legacy machine-id frontmatter fields from every task and to-do
// note: `id:` (the vault-owned uuid that moved into the registry, dt-20),
// `url:` (the old mirror address the registry now owns) and `todoist:` (the
// old twin anchor the registry now owns — the registry is the identity source).
// A project note carries a LIVE `todoist:` anchor (the task-manager project id), but
// project notes live outside taken/ and todos/, so this walk never touches one.
// Idempotent: a note carrying none of the fields is left untouched. Runs at
// chain start, per project, before any half reads notes.
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
        (!line.startsWith('id:') &&
          !line.startsWith('url:') &&
          !line.startsWith('todoist:')),
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
