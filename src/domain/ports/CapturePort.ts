import type { CanonicalTask } from '../data/CanonicalTask.js';

export interface CapturePort {
  capture(target: string): Promise<CanonicalTask[]>;
}
