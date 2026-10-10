import type { CanonicalTask } from '../application/data/CanonicalTask.js';

export interface AdoptTaskInput {
  task: CanonicalTask;
  application: string;
  slug: string;
  projectName: string;
  syncedAt: string;
}

export interface TaskCaptureVaultPort {
  listAdopted(project: string, slug: string): Promise<readonly string[]>;
  adopt(input: AdoptTaskInput): Promise<void>;
}
