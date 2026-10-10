import type { ProjectNoteData } from '../data/ProjectNoteData.js';

export interface NoteEnumeratorPort {
  listNotesInFolder(folder: string): Promise<string[]>;
  findProjectNotes(): Promise<ProjectNoteData[]>;
}
