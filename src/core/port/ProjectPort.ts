import type { CanonicalProject } from '../application/data/CanonicalProject.js';

export interface ProjectPort {
  readProject(target: string): Promise<CanonicalProject | null>;
  createProject(target: string, name: string): Promise<CanonicalProject>;
  renameProject(target: string, name: string): Promise<void>;
  setArchived(target: string, archived: boolean): Promise<void>;
  archivedTime(target: string): Promise<string | null>;
}
