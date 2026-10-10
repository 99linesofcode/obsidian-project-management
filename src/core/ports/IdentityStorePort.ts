import type { ProjectIdentityData } from '../ProjectIdentityData.js';

export interface IdentityStorePort {
  getIdentity(
    projectName: string,
    connectionSlug: string,
  ): Promise<ProjectIdentityData | null>;
  setIdentity(
    projectName: string,
    connectionSlug: string,
    identity: ProjectIdentityData,
  ): Promise<void>;
}
