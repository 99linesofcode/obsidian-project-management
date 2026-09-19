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
  findProjectNotes(): Promise<ProjectNoteData[]>;
  onNoteChanged(cb: (path: string) => void): void;
  onNoteDeleted(cb: (path: string) => void): void;
}
