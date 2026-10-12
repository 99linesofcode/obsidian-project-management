import { ProjectIdentityDataTransferObject } from '../../port/data/ProjectIdentityDataTransferObject.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { ProjectAddressing } from '../../port/data/ProjectAddressing.js';
import type { ProjectSummary } from '../../port/data/ProjectSummary.js';
import type { ProjectSetupSurface } from '../../port/MirrorPort.js';
import type { ResolveProjectBoardAction } from './ResolveProjectBoardAction.js';

export interface EnsureProjectBoardInput {
  projectName: string;
  connectionSlug: string;
  target: string;
  setup: ProjectSetupSurface;
}

export class EnsureProjectBoardAction {
  constructor(
    private readonly syncState: RegistryPort,
    private readonly statusOptions: string[],
    private readonly resolveBoard: ResolveProjectBoardAction,
  ) {}

  async execute(input: EnsureProjectBoardInput): Promise<void> {
    const { setup, target } = input;
    const identity = await this.syncState.getIdentity(
      input.projectName,
      input.connectionSlug,
    );
    if (identity?.projectHandle) {
      return;
    }

    if (target === '') {
      return;
    }

    const resolved = await this.resolveBoard.execute({ target, setup });
    const addressing =
      resolved.kind === 'create'
        ? await this.createOrAdoptOrphan(setup, target, resolved.boardTitle)
        : await setup.adoptProject(target, resolved.board, this.statusOptions);

    const merged = new ProjectIdentityDataTransferObject({
      target,
      targetHandle: resolved.discovery.targetHandle,
      projectHandle: addressing.projectHandle,
      statusFieldHandle: addressing.statusFieldHandle,
      statusOptions: [...addressing.statusOptions],
    });
    await this.syncState.setIdentity(
      input.projectName,
      input.connectionSlug,
      merged,
    );
  }

  private async createOrAdoptOrphan(
    setup: ProjectSetupSurface,
    target: string,
    targetName: string,
  ): Promise<ProjectAddressing> {
    const orphan = await this.findOrphanProject(setup, targetName);
    if (orphan === null) {
      return setup.createProjectWithStatus(
        target,
        targetName,
        this.statusOptions,
      );
    }
    return setup.adoptProject(target, orphan, this.statusOptions);
  }

  private async findOrphanProject(
    setup: ProjectSetupSurface,
    targetName: string,
  ): Promise<ProjectSummary | null> {
    const candidates = await setup.listProjects();
    const orphan = candidates.find(
      (candidate) =>
        candidate.project.name === targetName && candidate.targets.length === 0,
    );
    return orphan?.project ?? null;
  }
}
