import type { ProjectStateData } from '../DataTransferObjects/ProjectStateData.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';

// UC: probe every discovered project's lightweight remote state in one cheap
// query, so the poll can gate the expensive board fetch on updatedAt. Resolves
// each project's node id from its stored identity; a project without one cannot
// be probed and is skipped. The result is keyed by project name, pairing each
// probe with the per-project stored update the caller compares against.
export class ProbeProjectsAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(
    projectNames: string[],
  ): Promise<Map<string, ProjectStateData>> {
    const nodeIdsByProject = new Map<string, string>();
    for (const projectName of projectNames) {
      const identity = await this.syncState.getIdentity(projectName);
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
