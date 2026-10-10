import type { CanonicalTask } from '../application/data/CanonicalTask.js';

export interface CapturePort {
  capture(target: string): Promise<CanonicalTask[]>;
}
