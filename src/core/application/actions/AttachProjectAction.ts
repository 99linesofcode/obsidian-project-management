import { ProjectIdentityDataTransferObject } from '../../port/data/ProjectIdentityDataTransferObject.js';
import { DomainError } from '../../domain/errors/DomainError.js';
import type { ProjectSetupSurface } from '../../port/MirrorPort.js';
import type { ResolveProjectBoardAction } from './ResolveProjectBoardAction.js';

export interface AttachProjectInput {
  target: string;
  setup: ProjectSetupSurface;
}

export class AttachProjectAction {
  constructor(private readonly resolveBoard: ResolveProjectBoardAction) {}

  async execute(
    data: AttachProjectInput,
  ): Promise<ProjectIdentityDataTransferObject> {
    if (!data.target) {
      throw new DomainError('AttachProjectAction: target is required');
    }

    const resolved = await this.resolveBoard.execute({
      target: data.target,
      setup: data.setup,
    });
    if (resolved.kind === 'create') {
      return new ProjectIdentityDataTransferObject({
        target: data.target,
        targetHandle: resolved.discovery.targetHandle,
        projectHandle: '',
        statusFieldHandle: '',
        statusOptions: [],
      });
    }

    const addressing = await data.setup.readProjectAddressing(resolved.board);
    if (addressing === null) {
      throw new DomainError(
        `AttachProjectAction: board ${resolved.board.name} could not be resolved`,
      );
    }
    return new ProjectIdentityDataTransferObject({
      target: data.target,
      targetHandle: resolved.discovery.targetHandle,
      projectHandle: addressing.projectHandle,
      statusFieldHandle: addressing.statusFieldHandle,
      statusOptions: [...addressing.statusOptions],
    });
  }
}
