import type { ProjectIdentityDataTransferObject } from '../application/data/ProjectIdentityDataTransferObject.js';

export interface IdentityStorePort {
  getIdentity(
    projectName: string,
    connectionSlug: string,
  ): Promise<ProjectIdentityDataTransferObject | null>;
  setIdentity(
    projectName: string,
    connectionSlug: string,
    identity: ProjectIdentityDataTransferObject,
  ): Promise<void>;
}
