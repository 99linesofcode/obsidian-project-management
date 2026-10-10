import type { AdoptedProject } from '../application/data/AdoptedProject.js';
import type { CapturedProject } from '../application/data/CapturedProject.js';

export interface ProjectCaptureVaultPort {
  listAdopted(): Promise<readonly AdoptedProject[]>;
  adopt(
    project: CapturedProject,
    application: string,
    slug: string,
  ): Promise<void>;
}
