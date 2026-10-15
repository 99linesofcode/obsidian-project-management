import type { MirrorPort } from './MirrorPort.js';

export interface MirrorAdapterFactoryPort {
  create(
    application: string,
    target: string,
    connectionSlug: string,
    projectName: string,
  ): MirrorPort | null;
}
