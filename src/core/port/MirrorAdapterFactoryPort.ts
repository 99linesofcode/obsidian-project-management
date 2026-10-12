import type { MirrorPort } from './MirrorPort.js';

export interface CaptureSource {
  readonly application: string;
  readonly capture: Required<Pick<MirrorPort, 'captureProjects'>>;
}

// The core's need: build the mirror adapter a connection's application and
// target name, and enumerate the applications whose projects can be captured.
// The provider table implements it; it is a factory, not a facet of the mirror.
export interface MirrorAdapterFactoryPort {
  create(
    application: string,
    target: string,
    connectionSlug: string,
    projectName: string,
  ): MirrorPort | null;
  captureSources?(): readonly CaptureSource[];
}
