import type { CanonicalField } from '../../domain/canonicalField.js';
import type { MergeResult } from '../../domain/MergeResult.js';

export class PassRecord {
  readonly field: CanonicalField;
  readonly result: MergeResult;
  readonly written: readonly string[];
  readonly skipped: readonly string[];
  readonly advanced: readonly string[];
  readonly failed: readonly string[];

  constructor(init: {
    field: CanonicalField;
    result: MergeResult;
    written: readonly string[];
    skipped: readonly string[];
    advanced: readonly string[];
    failed: readonly string[];
  }) {
    this.field = init.field;
    this.result = init.result;
    this.written = init.written;
    this.skipped = init.skipped;
    this.advanced = init.advanced;
    this.failed = init.failed;
  }
}
