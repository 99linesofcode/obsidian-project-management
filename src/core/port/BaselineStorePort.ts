import type { CanonicalField } from '../domain/canonicalField.js';
import type { Baseline } from '../application/data/Baseline.js';

export type BaselineField = CanonicalField | 'lifecycle';

export interface BaselineStorePort {
  read(
    entityId: string,
    field: BaselineField,
    side: string,
  ): Promise<Baseline | null>;
  write(
    entityId: string,
    field: BaselineField,
    side: string,
    baseline: Baseline,
  ): Promise<void>;
}
