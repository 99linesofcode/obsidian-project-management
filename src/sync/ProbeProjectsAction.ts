import type { ProjectStateData } from '../shared/ProjectStateData.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';

export class ProbeProjectsAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(
    targets: Array<{ projectName: string; connectionSlug: string }>,
  ): Promise<Map<string, ProjectStateData>> {
    const nodeIdsByProject = new Map<string, string>();
    for (const { projectName, connectionSlug } of targets) {
      const identity = await this.syncState.getIdentity(
        projectName,
        connectionSlug,
      );
      if (identity?.projectNodeId) {
        nodeIdsByProject.set(projectName, identity.projectNodeId);
      }
    }

    const states = await this.projectManagement.fetchProjectStates([
      ...nodeIdsByProject.values(),
    ]);

    const probed = new Map<string, ProjectStateData>();
    for (const [projectName, nodeId] of nodeIdsByProject) {
      const state = states.get(nodeId);
      if (state) {
        probed.set(projectName, state);
      }
    }
    return probed;
  }
}
