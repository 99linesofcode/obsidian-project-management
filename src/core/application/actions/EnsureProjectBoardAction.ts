import { ProjectIdentityDataTransferObject } from '../../port/data/ProjectIdentityDataTransferObject.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { ProjectSetupSurface } from '../../port/MirrorPort.js';

export interface EnsureProjectBoardInput {
  projectName: string;
  connectionSlug: string;
  target: string;
  setup: ProjectSetupSurface;
}

// A declared connection resolves-or-creates its remote project by name (or the
// connection's explicit target) and records its addressing, once. A connection
// that already carries an addressing is left alone.
export class EnsureProjectBoardAction {
  constructor(
    private readonly syncState: RegistryPort,
    private readonly statusOptions: string[],
  ) {}

  async execute(input: EnsureProjectBoardInput): Promise<void> {
    const identity = await this.syncState.getIdentity(
      input.projectName,
      input.connectionSlug,
    );
    if (identity?.projectHandle) {
      return;
    }

    const addressing = await input.setup.resolveOrCreateProject(
      input.target,
      input.projectName,
      this.statusOptions,
    );
    await this.syncState.setIdentity(
      input.projectName,
      input.connectionSlug,
      new ProjectIdentityDataTransferObject({
        target: input.target,
        targetHandle: '',
        projectHandle: addressing.projectHandle,
        statusFieldHandle: addressing.statusFieldHandle,
        statusOptions: [...addressing.statusOptions],
      }),
    );
  }
}
