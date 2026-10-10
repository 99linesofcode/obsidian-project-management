import type { ProjectStateData } from '../shared/ProjectStateData.js';
import type { ProjectSetupPort } from '../core/ports/ProjectSetupPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';

export class ProbeProjectsAction {
  constructor(
    private readonly setup: ProjectSetupPort,
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

    const states = await this.setup.probeProjects([
      ...nodeIdsByProject.values(),
    ]);
    const stateByHandle = new Map(states.map((state) => [state.handle, state]));

    const probed = new Map<string, ProjectStateData>();
    for (const [projectName, nodeId] of nodeIdsByProject) {
      const state = stateByHandle.get(nodeId);
      if (state) {
        probed.set(projectName, {
          projectId: state.handle,
          updatedAt: state.updatedAt,
          closed: state.archived,
        });
      }
    }
    return probed;
  }
}
