import type { MirrorPort } from './MirrorPort.js';

export interface MirrorAdapterFactoryPort {
  create(
    application: string,
    target: string,
    connectionSlug: string,
    projectId: string,
  ): MirrorPort | null;
}
