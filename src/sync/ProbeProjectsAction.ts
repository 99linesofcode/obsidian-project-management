import type { ProjectStateData } from '../shared/ProjectStateData.js';
import type { ProjectSetupFactoryPort } from '../core/ports/ProjectSetupFactoryPort.js';
import type { IdentityStorePort } from '../core/ports/IdentityStorePort.js';

export class ProbeProjectsAction {
  constructor(
    private readonly setupFactory: ProjectSetupFactoryPort,
    private readonly syncState: IdentityStorePort,
  ) {}

  async execute(
    targets: ReadonlyArray<{
      projectName: string;
      connectionSlug: string;
      application: string;
    }>,
  ): Promise<Map<string, ProjectStateData>> {
    const targetsByApplication = new Map<
      string,
      Array<{ projectName: string; connectionSlug: string }>
    >();
    for (const { application, projectName, connectionSlug } of targets) {
      const group = targetsByApplication.get(application);
      const target = { projectName, connectionSlug };
      if (group === undefined) {
        targetsByApplication.set(application, [target]);
      } else {
        group.push(target);
      }
    }

    const probed = new Map<string, ProjectStateData>();
    for (const [application, group] of targetsByApplication) {
      const setup = this.setupFactory.setupFor(application);
      if (setup === null) {
        continue;
      }

      const nodeIdsByProject = new Map<string, string>();
      for (const { projectName, connectionSlug } of group) {
        const identity = await this.syncState.getIdentity(
          projectName,
          connectionSlug,
        );
        if (identity?.projectNodeId) {
          nodeIdsByProject.set(projectName, identity.projectNodeId);
        }
      }

      const states = await setup.probeProjects([
        ...nodeIdsByProject.values(),
      ]);
      const stateByHandle = new Map(
        states.map((state) => [state.handle, state]),
      );

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
    }
    return probed;
  }
}
