export interface ProjectCaptureCursorPort {
  read(application: string): Promise<string | null>;
  write(application: string, iso: string): Promise<void>;
}
