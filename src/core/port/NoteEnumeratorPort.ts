import type { ProjectNoteDataTransferObject } from '../application/data/ProjectNoteDataTransferObject.js';

export interface NoteEnumeratorPort {
  listNotesInFolder(folder: string): Promise<string[]>;
  findProjectNotes(): Promise<ProjectNoteDataTransferObject[]>;
}
