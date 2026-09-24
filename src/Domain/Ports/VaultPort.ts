// The core's need for the vault: read, create, write and rename notes by
// path, subscribe to note changes and deletions, and enumerate the project
// notes that declare a synced project. Designed for the core, not to mimic
// Obsidian's API. The real adapter lives in Infrastructure.
import type { ProjectNoteData } from '../DataTransferObjects/ProjectNoteData.js';

export interface VaultPort {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
  createNote(path: string, content: string): Promise<void>;
  writeNote(path: string, content: string): Promise<void>;
  renameNote(oldPath: string, newPath: string): Promise<void>;
  // Moves every file under a folder prefix to the same relative path under
  // another prefix, creating destination folders as needed. Any extension.
  moveFolder(fromPrefix: string, toPrefix: string): Promise<void>;
  // Markdown paths under a folder prefix — used to find a task's to-dos.
  listNotesInFolder(folder: string): Promise<string[]>;
  // Moves a note to the vault-internal trash; never a permanent delete.
  trashNote(path: string): Promise<void>;
  findProjectNotes(): Promise<ProjectNoteData[]>;
  onNoteChanged(cb: (path: string) => void): void;
  onNoteDeleted(cb: (path: string) => void): void;
  onNoteRenamed(cb: (oldPath: string, newPath: string) => void): void;
}
