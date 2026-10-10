import type { CanonicalProject } from '../data/CanonicalProject.js';

export interface ProjectPort {
  readProject(target: string): Promise<CanonicalProject | null>;
  createProject(target: string, name: string): Promise<CanonicalProject>;
  setArchived(target: string, archived: boolean): Promise<void>;
}
