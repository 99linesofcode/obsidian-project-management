import type { ProjectStatusOption } from './ProjectStatusOption.js';

export class ProjectIdentityData {
  repoUrl: string;
  repoNodeId: string;
  projectNodeId: string;
  statusFieldId: string;
  statusOptions: ProjectStatusOption[];

  constructor(init: ProjectIdentityData) {
    this.repoUrl = init.repoUrl;
    this.repoNodeId = init.repoNodeId;
    this.projectNodeId = init.projectNodeId;
    this.statusFieldId = init.statusFieldId;
    this.statusOptions = init.statusOptions;
  }
}
