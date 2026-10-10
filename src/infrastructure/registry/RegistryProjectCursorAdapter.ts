import type { ProjectCaptureCursorPort } from '../../core/port/ProjectCaptureCursorPort.js';

export interface ProjectCursorStore {
  getProjectCursor(portId: string): Promise<string | null>;
  setProjectCursor(portId: string, iso: string): Promise<void>;
}

export class RegistryProjectCursorAdapter implements ProjectCaptureCursorPort {
  constructor(private readonly store: ProjectCursorStore) {}

  read(application: string): Promise<string | null> {
    return this.store.getProjectCursor(application);
  }

  write(application: string, iso: string): Promise<void> {
    return this.store.setProjectCursor(application, iso);
  }
}
