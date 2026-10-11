import type { CanonicalField } from '../domain/canonicalField.js';
import type { OriginObservation } from '../domain/OriginObservation.js';
import type { AdoptedProject } from '../application/data/AdoptedProject.js';
import type { CanonicalFieldWrite } from '../application/data/CanonicalFieldWrite.js';
import type { CanonicalTask } from '../application/data/CanonicalTask.js';
import type { CapturedProject } from '../application/data/CapturedProject.js';
import type { ConnectionDataTransferObject } from '../application/data/ConnectionDataTransferObject.js';
import type { ProjectNoteDataTransferObject } from '../application/data/ProjectNoteDataTransferObject.js';

// The vault as the core's origin: read, write, enumerate and watch notes;
// observe and write a task note's canonical fields; read a project's declared
// connections and task-note paths; observe and apply a project's archived
// state; adopt a captured project. One collaborator, one surface of vault
// primitives — the capture-adoption orchestration lives in the action that
// drives this port, never in the adapter.
export interface VaultPort {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
  createNote(path: string, content: string): Promise<void>;
  writeNote(path: string, content: string): Promise<void>;
  renameNote(oldPath: string, newPath: string): Promise<void>;
  trashNote(path: string): Promise<void>;
  listNotesInFolder(folder: string): Promise<string[]>;
  findProjectNotes(): Promise<ProjectNoteDataTransferObject[]>;

  onNoteChanged(cb: (path: string) => void): void;
  onNoteDeleted(cb: (path: string) => void): void;
  onNoteRenamed(cb: (oldPath: string, newPath: string) => void): void;

  observe(handle: string, field: CanonicalField): Promise<OriginObservation>;
  // The core's need: read the whole origin task to create its missing mirror
  // item. Null when the handle names no task note.
  readTask(handle: string): Promise<CanonicalTask | null>;
  applyField(write: CanonicalFieldWrite): Promise<void>;

  readConnections(
    project: string,
  ): Promise<readonly ConnectionDataTransferObject[]>;
  listEntities(project: string): Promise<readonly string[]>;

  observeProject(project: string): Promise<OriginObservation>;
  applyProjectArchived(project: string, archived: boolean): Promise<void>;

  listAdoptedProjects(): Promise<readonly AdoptedProject[]>;
  adoptProject(
    project: CapturedProject,
    application: string,
    slug: string,
  ): Promise<void>;
}
