import { ProjectIdentityDataTransferObject } from '../data/ProjectIdentityDataTransferObject.js';
import { DomainError } from '../../domain/errors/DomainError.js';
import type { ProjectSetupPort } from '../../port/ProjectSetupPort.js';
import { deriveBoardChoice } from '../../domain/deriveBoardChoice.js';
import { nameFromTarget } from '../../domain/nameFromTarget.js';

export interface AttachProjectInput {
  target: string;
  setup: ProjectSetupPort;
}

export class AttachProjectAction {
  async execute(
    data: AttachProjectInput,
  ): Promise<ProjectIdentityDataTransferObject> {
    if (!data.target) {
      throw new DomainError('AttachProjectAction: target is required');
    }

    const targetName = nameFromTarget(data.target);
    const discovery = await data.setup.discoverProjects(data.target);
    const choice = deriveBoardChoice(targetName, discovery.projects);
    if (choice.kind === 'ambiguous') {
      throw new DomainError(
        `AttachProjectAction: target ${data.target} has several boards and none is titled "${targetName}"`,
      );
    }
    if (choice.kind === 'create') {
      return new ProjectIdentityDataTransferObject({
        target: data.target,
        targetHandle: discovery.targetHandle,
        projectHandle: '',
        statusFieldHandle: '',
        statusOptions: [],
      });
    }

    const addressing = await data.setup.readProjectAddressing(choice.board);
    if (addressing === null) {
      throw new DomainError(
        `AttachProjectAction: board ${choice.board.name} could not be resolved`,
      );
    }
    return new ProjectIdentityDataTransferObject({
      target: data.target,
      targetHandle: discovery.targetHandle,
      projectHandle: addressing.projectHandle,
      statusFieldHandle: addressing.statusFieldHandle,
      statusOptions: [...addressing.statusOptions],
    });
  }
}
