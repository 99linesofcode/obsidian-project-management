import type { ProjectStatusOption } from './ProjectStatusOption.js';

export class ProjectAddressing {
  readonly projectHandle: string;
  readonly statusFieldHandle: string;
  readonly statusOptions: readonly ProjectStatusOption[];
  // The address a connection's downstream steps use — the resolved project's
  // own address (a code host's repository, a task manager's project). Empty when
  // the adapter did not resolve a distinct address.
  readonly effectiveTarget: string;

  constructor(init: {
    projectHandle: string;
    statusFieldHandle: string;
    statusOptions: readonly ProjectStatusOption[];
    effectiveTarget?: string;
  }) {
    this.projectHandle = init.projectHandle;
    this.statusFieldHandle = init.statusFieldHandle;
    this.statusOptions = init.statusOptions;
    this.effectiveTarget = init.effectiveTarget ?? '';
  }
}
