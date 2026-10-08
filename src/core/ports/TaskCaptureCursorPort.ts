export interface TaskCaptureCursorPort {
  read(project: string, slug: string): Promise<string | null>;
  write(project: string, slug: string, handle: string): Promise<void>;
}
