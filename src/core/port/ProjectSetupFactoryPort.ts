import type { ProjectSetupSurface } from './MirrorPort.js';

// The core's need: reach a tool's project-setup surface by application. The
// provider table implements it; a tool without setup resolves to null.
export interface ProjectSetupFactoryPort {
  setupFor(application: string): ProjectSetupSurface | null;
}
