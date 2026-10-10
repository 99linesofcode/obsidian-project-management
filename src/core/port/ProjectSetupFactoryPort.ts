import type { ProjectSetupPort } from './ProjectSetupPort.js';

export interface ProjectSetupFactoryPort {
  setupFor(application: string): ProjectSetupPort | null;
}
