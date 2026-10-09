import type { ProjectNoteData } from '../ProjectNoteData.js';

export interface NoteEnumeratorPort {
  listNotesInFolder(folder: string): Promise<string[]>;
  findProjectNotes(): Promise<ProjectNoteData[]>;
}
