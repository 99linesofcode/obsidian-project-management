import type { CanonicalField } from '../domain/canonicalField.js';

export interface TimestampedPort {
  fieldTime(handle: string, field: CanonicalField): Promise<string | null>;
}
