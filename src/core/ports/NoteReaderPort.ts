export interface NoteReaderPort {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
}
