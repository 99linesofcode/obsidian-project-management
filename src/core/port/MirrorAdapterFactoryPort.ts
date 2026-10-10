import type { RegisteredAdapter } from '../application/data/RegisteredAdapter.js';
import type { ProjectCapturePort } from './ProjectCapturePort.js';

export interface CaptureSource {
  readonly application: string;
  readonly capture: ProjectCapturePort;
}

export interface MirrorAdapterFactoryPort {
  create(
    application: string,
    target: string,
    connectionSlug: string,
    projectName: string,
  ): RegisteredAdapter | null;
  captureSources?(): readonly CaptureSource[];
}
