import type { OriginObservation } from '../domain/OriginObservation.js';

export interface ProjectLifecycleOriginPort {
  observeProject(project: string): Promise<OriginObservation>;
  applyProjectArchived(project: string, archived: boolean): Promise<void>;
}
