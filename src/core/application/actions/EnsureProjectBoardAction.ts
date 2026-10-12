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
// connection's explicit target) and records its addressing. The action always
// resolves: the adapter decides whether the remote project still exists (adopt
// it) or is gone (re-create it), so a removed remote is rebuilt.
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
