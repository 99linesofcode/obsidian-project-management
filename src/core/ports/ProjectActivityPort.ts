import type { ProjectActivityObservation } from '../data/ProjectActivityObservation.js';

// The core's need: notice that new work appeared on a frozen project's mirror,
// so the project can reactivate. An adapter without the surface declares no
// `project-activity`.
export interface ProjectActivityPort {
  latestActivity(
    target: string,
    etag?: string,
  ): Promise<ProjectActivityObservation>;
}
