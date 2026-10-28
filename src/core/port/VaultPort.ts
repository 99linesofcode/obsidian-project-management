import type { CanonicalField } from '../domain/canonicalField.js';
import type { OriginObservation } from '../domain/OriginObservation.js';
import type { CanonicalFieldWrite } from './data/CanonicalFieldWrite.js';
import type { CanonicalTask } from './data/CanonicalTask.js';
import type { ConnectionDataTransferObject } from './data/ConnectionDataTransferObject.js';
import type { ProjectNoteDataTransferObject } from './data/ProjectNoteDataTransferObject.js';

export interface VaultPort {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
  createNote(path: string, content: string): Promise<void>;
  writeNote(path: string, content: string): Promise<void>;
  renameNote(oldPath: string, newPath: string): Promise<void>;
  trashNote(path: string): Promise<void>;
  listNotesInFolder(folder: string): Promise<string[]>;
  readNoteIds(): Promise<readonly { id: string; path: string }[]>;
  findProjectNotes(): Promise<ProjectNoteDataTransferObject[]>;

  onNoteChanged(cb: (path: string) => void): void;
  onNoteDeleted(cb: (path: string) => void): void;
  onNoteRenamed(cb: (oldPath: string, newPath: string) => void): void;

  observe(handle: string, field: CanonicalField): Promise<OriginObservation>;
  readTask(handle: string): Promise<CanonicalTask | null>;
  applyField(write: CanonicalFieldWrite): Promise<void>;

  readConnections(
    projectId: string,
  ): Promise<readonly ConnectionDataTransferObject[]>;
  listEntities(projectId: string): Promise<readonly string[]>;

  observeProject(projectId: string): Promise<OriginObservation>;
  applyProjectArchived(projectId: string, archived: boolean): Promise<void>;
}
