import type { MergeResult } from './MergeResult.js';

export class ProjectLifecycleRecord {
  readonly frozen: boolean;
  readonly result: MergeResult;
  readonly written: readonly string[];
  readonly advanced: readonly string[];
  readonly failed: readonly string[];

  constructor(init: {
    frozen: boolean;
    result: MergeResult;
    written: readonly string[];
    advanced: readonly string[];
    failed: readonly string[];
  }) {
    this.frozen = init.frozen;
    this.result = init.result;
    this.written = init.written;
    this.advanced = init.advanced;
    this.failed = init.failed;
  }
}
