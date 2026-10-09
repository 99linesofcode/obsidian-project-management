import { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { ProjectAddressing } from '../core/data/ProjectAddressing.js';
import type { ProjectSummary } from '../core/data/ProjectSummary.js';
import type { ProjectSetupPort } from '../core/ports/ProjectSetupPort.js';
import { deriveBoardChoice } from './deriveBoardChoice.js';
import { repoNameFromUrl } from './repoNameFromUrl.js';

export interface EnsureProjectBoardInput {
  projectName: string;
  connectionSlug: string;
}

export class EnsureProjectBoardAction {
  constructor(
    private readonly setup: ProjectSetupPort,
    private readonly syncState: SyncStatePort,
    private readonly statusOptions: string[],
  ) {}

  async execute(input: EnsureProjectBoardInput): Promise<void> {
    const identity = await this.syncState.getIdentity(
      input.projectName,
      input.connectionSlug,
    );
    if (identity?.projectNodeId) {
      return;
    }

    const repoUrl = identity?.repoUrl ?? '';
    if (repoUrl === '') {
      return;
    }

    const repoName = repoNameFromUrl(repoUrl);
    const discovery = await this.setup.discoverProjects(repoUrl);
    const choice = deriveBoardChoice(repoName, discovery.projects);
    if (choice.kind === 'ambiguous') {
      throw new Error(
        `EnsureProjectBoardAction: repository ${repoUrl} has several boards and none is titled "${repoName}"; not creating or adopting one`,
      );
    }

    const addressing =
      choice.kind === 'create'
        ? await this.createOrAdoptOrphan(repoUrl, repoName)
        : await this.setup.adoptProject(
            repoUrl,
            choice.board,
            this.statusOptions,
          );

    const merged = new ProjectIdentityData({
      repoUrl,
      repoNodeId: discovery.targetHandle,
      projectNodeId: addressing.projectHandle,
      statusFieldId: addressing.statusFieldHandle,
      statusOptions: [...addressing.statusOptions],
    });
    await this.syncState.setIdentity(
      input.projectName,
      input.connectionSlug,
      merged,
    );
  }

  private async createOrAdoptOrphan(
    repoUrl: string,
    repoName: string,
  ): Promise<ProjectAddressing> {
    const orphan = await this.findOrphanProject(repoName);
    if (orphan === null) {
      return this.setup.createProjectWithStatus(
        repoUrl,
        repoName,
        this.statusOptions,
      );
    }
    return this.setup.adoptProject(repoUrl, orphan, this.statusOptions);
  }

  private async findOrphanProject(
    repoName: string,
  ): Promise<ProjectSummary | null> {
    const candidates = await this.setup.listProjects();
    const orphan = candidates.find(
      (candidate) =>
        candidate.project.name === repoName && candidate.targets.length === 0,
    );
    return orphan?.project ?? null;
  }
}
