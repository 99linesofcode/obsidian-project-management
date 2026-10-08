import type { CanonicalField } from '../canonicalField.js';
import type { CanonicalFieldWrite } from '../data/CanonicalFieldWrite.js';
import type { CanonicalTask } from '../data/CanonicalTask.js';
import type { OriginObservation } from '../data/OriginObservation.js';

export interface OriginPort {
  observe(handle: string, field: CanonicalField): Promise<OriginObservation>;
  readTask(handle: string): Promise<CanonicalTask | null>;
  applyField(write: CanonicalFieldWrite): Promise<void>;
  trash(handle: string): Promise<void>;
}
