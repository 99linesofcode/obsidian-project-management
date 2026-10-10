export interface NoteWriterPort {
  createNote(path: string, content: string): Promise<void>;
  writeNote(path: string, content: string): Promise<void>;
  renameNote(oldPath: string, newPath: string): Promise<void>;
  trashNote(path: string): Promise<void>;
}
