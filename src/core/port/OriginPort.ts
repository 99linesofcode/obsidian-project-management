import type { CanonicalField } from '../domain/canonicalField.js';
import type { CanonicalFieldWrite } from '../application/data/CanonicalFieldWrite.js';
import type { CanonicalTask } from '../application/data/CanonicalTask.js';
import type { OriginObservation } from '../application/data/OriginObservation.js';

export interface OriginPort {
  observe(handle: string, field: CanonicalField): Promise<OriginObservation>;
  // The core's need: read the whole origin task to create its missing mirror
  // item. Null when the handle names no task note.
  readTask(handle: string): Promise<CanonicalTask | null>;
  applyField(write: CanonicalFieldWrite): Promise<void>;
  trash(handle: string): Promise<void>;
}
