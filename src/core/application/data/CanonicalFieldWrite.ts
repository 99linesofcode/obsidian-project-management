import type { CanonicalField } from '../../domain/canonicalField.js';

export class CanonicalFieldWrite {
  readonly handle: string;
  readonly field: CanonicalField;
  readonly value: string | null;

  constructor(init: {
    handle: string;
    field: CanonicalField;
    value: string | null;
  }) {
    this.handle = init.handle;
    this.field = init.field;
    this.value = init.value;
  }
}
