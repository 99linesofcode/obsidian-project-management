import type { MirrorPort } from './MirrorPort.js';

// The core's need: build the mirror adapter a connection's application and
// target name. The provider table implements it; it is a factory, not a facet
// of the mirror.
export interface MirrorAdapterFactoryPort {
  create(
    application: string,
    target: string,
    connectionSlug: string,
    projectName: string,
  ): MirrorPort | null;
}
