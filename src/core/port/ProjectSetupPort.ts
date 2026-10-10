import type { ProjectAddressing } from '../application/data/ProjectAddressing.js';
import type { ProjectCandidate } from '../application/data/ProjectCandidate.js';
import type { ProjectDiscovery } from '../application/data/ProjectDiscovery.js';
import type { ProjectSummary } from '../application/data/ProjectSummary.js';

// The core's need: before a connection can mirror, its project must be resolved
// — the projects the target carries, one created or adopted with the core's
// Status vocabulary, and the addressing the core writes through. Designed for
// the core, not the provider's API. An adapter without the surface implements no
// setup port.
export interface ProjectSetupPort {
  discoverProjects(target: string): Promise<ProjectDiscovery>;
  readProjectAddressing(
    project: ProjectSummary,
  ): Promise<ProjectAddressing | null>;
  createProjectWithStatus(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing>;
  adoptProject(
    target: string,
    project: ProjectSummary,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing>;
  listProjects(): Promise<readonly ProjectCandidate[]>;
}
