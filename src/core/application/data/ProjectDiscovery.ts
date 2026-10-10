import type { ProjectSummary } from './ProjectSummary.js';

export class ProjectDiscovery {
  readonly targetHandle: string;
  readonly projects: readonly ProjectSummary[];

  constructor(init: {
    targetHandle: string;
    projects: readonly ProjectSummary[];
  }) {
    this.targetHandle = init.targetHandle;
    this.projects = init.projects;
  }
}
