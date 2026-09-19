// The core's need for the vault: read, create, write and rename notes by
// path, and subscribe to note changes. Designed for the core, not to mimic
// Obsidian's API. The real adapter lives in Infrastructure.
export interface VaultPort {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
  createNote(path: string, content: string): Promise<void>;
  writeNote(path: string, content: string): Promise<void>;
  renameNote(oldPath: string, newPath: string): Promise<void>;
  onNoteChanged(cb: (path: string) => void): void;
}
