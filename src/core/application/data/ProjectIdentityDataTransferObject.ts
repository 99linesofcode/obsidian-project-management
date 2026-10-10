import type { ProjectStatusOption } from './ProjectStatusOption.js';

export class ProjectIdentityDataTransferObject {
  readonly target: string;
  readonly targetHandle: string;
  readonly projectHandle: string;
  readonly statusFieldHandle: string;
  readonly statusOptions: ProjectStatusOption[];

  constructor(init: {
    target: string;
    targetHandle: string;
    projectHandle: string;
    statusFieldHandle: string;
    statusOptions: ProjectStatusOption[];
  }) {
    this.target = init.target;
    this.targetHandle = init.targetHandle;
    this.projectHandle = init.projectHandle;
    this.statusFieldHandle = init.statusFieldHandle;
    this.statusOptions = init.statusOptions;
  }
}
