import type { CapturedProject } from '../data/CapturedProject.js';

export interface ProjectCapturePort {
  captureProjects(): Promise<readonly CapturedProject[]>;
}
