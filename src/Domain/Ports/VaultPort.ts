// The core's need for the vault: read and create notes by path. Designed for
// the core, not to mimic Obsidian's API. The real adapter lands in a later
// ticket.
export interface VaultPort {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
  createNote(path: string, content: string): Promise<void>;
}
