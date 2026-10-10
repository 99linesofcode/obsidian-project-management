import type { CapturedProject } from '../application/data/CapturedProject.js';

export interface ProjectCapturePort {
  captureProjects(): Promise<readonly CapturedProject[]>;
}
