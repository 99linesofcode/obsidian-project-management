import type { CanonicalField } from '../canonicalField.js';

export interface TimestampedPort {
  fieldTime(handle: string, field: CanonicalField): Promise<string | null>;
}
