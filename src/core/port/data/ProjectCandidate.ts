import type { ProjectSummary } from './ProjectSummary.js';

export class ProjectCandidate {
  readonly project: ProjectSummary;
  readonly targets: readonly string[];

  constructor(init: { project: ProjectSummary; targets: readonly string[] }) {
    this.project = init.project;
    this.targets = init.targets;
  }
}
