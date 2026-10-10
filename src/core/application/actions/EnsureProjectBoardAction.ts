import { ProjectIdentityDataTransferObject } from '../data/ProjectIdentityDataTransferObject.js';
import type { IdentityStorePort } from '../../port/IdentityStorePort.js';
import type { ProjectAddressing } from '../data/ProjectAddressing.js';
import type { ProjectSummary } from '../data/ProjectSummary.js';
import type { ProjectSetupPort } from '../../port/ProjectSetupPort.js';
import { deriveBoardChoice } from '../../domain/deriveBoardChoice.js';
import { nameFromTarget } from '../../domain/nameFromTarget.js';

export interface EnsureProjectBoardInput {
  projectName: string;
  connectionSlug: string;
  setup: ProjectSetupPort;
}

export class EnsureProjectBoardAction {
  constructor(
    private readonly syncState: IdentityStorePort,
    private readonly statusOptions: string[],
  ) {}

  async execute(input: EnsureProjectBoardInput): Promise<void> {
    const { setup } = input;
    const identity = await this.syncState.getIdentity(
      input.projectName,
      input.connectionSlug,
    );
    if (identity?.projectHandle) {
      return;
    }

    const target = identity?.target ?? '';
    if (target === '') {
      return;
    }

    const targetName = nameFromTarget(target);
    const discovery = await setup.discoverProjects(target);
    const choice = deriveBoardChoice(targetName, discovery.projects);
    if (choice.kind === 'ambiguous') {
      throw new Error(
        `EnsureProjectBoardAction: target ${target} has several boards and none is titled "${targetName}"; not creating or adopting one`,
      );
    }

    const addressing =
      choice.kind === 'create'
        ? await this.createOrAdoptOrphan(setup, target, targetName)
        : await setup.adoptProject(target, choice.board, this.statusOptions);

    const merged = new ProjectIdentityDataTransferObject({
      target,
      targetHandle: discovery.targetHandle,
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
    setup: ProjectSetupPort,
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
    setup: ProjectSetupPort,
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
