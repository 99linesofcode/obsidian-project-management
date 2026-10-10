import type { ProjectNoteData } from '../application/data/ProjectNoteData.js';

export interface NoteEnumeratorPort {
  listNotesInFolder(folder: string): Promise<string[]>;
  findProjectNotes(): Promise<ProjectNoteData[]>;
}
