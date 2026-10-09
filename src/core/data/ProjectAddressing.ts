export interface ProjectStatusOption {
  readonly id: string;
  readonly name: string;
}

export class ProjectAddressing {
  readonly projectHandle: string;
  readonly statusFieldHandle: string;
  readonly statusOptions: readonly ProjectStatusOption[];

  constructor(init: {
    projectHandle: string;
    statusFieldHandle: string;
    statusOptions: readonly ProjectStatusOption[];
  }) {
    this.projectHandle = init.projectHandle;
    this.statusFieldHandle = init.statusFieldHandle;
    this.statusOptions = init.statusOptions;
  }
}
