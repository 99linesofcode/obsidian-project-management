import type { CanonicalField } from '../canonicalField.js';
import type { Baseline } from '../data/Baseline.js';

export interface BaselineStorePort {
  read(
    entityId: string,
    field: CanonicalField,
    side: string,
  ): Promise<Baseline | null>;
  write(
    entityId: string,
    field: CanonicalField,
    side: string,
    baseline: Baseline,
  ): Promise<void>;
}
