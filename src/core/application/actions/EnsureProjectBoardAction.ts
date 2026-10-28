import { ProjectIdentityDataTransferObject } from '../../port/data/ProjectIdentityDataTransferObject.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { ProjectSetupSurface } from '../../port/MirrorPort.js';

export interface EnsureProjectBoardInput {
  projectId: string;
  projectName: string;
  connectionSlug: string;
  target: string;
  setup: ProjectSetupSurface;
}

export class EnsureProjectBoardAction {
  constructor(
    private readonly syncState: RegistryPort,
    private readonly statusOptions: string[],
  ) {}

  async execute(input: EnsureProjectBoardInput): Promise<void> {
    const addressing = await input.setup.resolveOrCreateProject(
      input.target,
      input.projectName,
      this.statusOptions,
    );
    if (addressing === null) {
      return;
    }
    await this.syncState.setIdentity(
      input.projectId,
      input.connectionSlug,
      new ProjectIdentityDataTransferObject({
        target: addressing.effectiveTarget || input.target,
        targetHandle: '',
        projectHandle: addressing.projectHandle,
        statusFieldHandle: addressing.statusFieldHandle,
        statusOptions: [...addressing.statusOptions],
      }),
    );
  }
}
