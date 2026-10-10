import type { MergeResult } from '../../domain/MergeResult.js';

export class ProjectLifecycleRecord {
  readonly frozen: boolean;
  readonly wasFrozen: boolean;
  readonly result: MergeResult;
  readonly written: readonly string[];
  readonly advanced: readonly string[];
  readonly failed: readonly string[];

  constructor(init: {
    frozen: boolean;
    wasFrozen: boolean;
    result: MergeResult;
    written: readonly string[];
    advanced: readonly string[];
    failed: readonly string[];
  }) {
    this.frozen = init.frozen;
    this.wasFrozen = init.wasFrozen;
    this.result = init.result;
    this.written = init.written;
    this.advanced = init.advanced;
    this.failed = init.failed;
  }
}
