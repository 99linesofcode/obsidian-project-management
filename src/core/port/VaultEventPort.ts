export interface VaultEventPort {
  onNoteChanged(cb: (path: string) => void): void;
  onNoteDeleted(cb: (path: string) => void): void;
  onNoteRenamed(cb: (oldPath: string, newPath: string) => void): void;
}
