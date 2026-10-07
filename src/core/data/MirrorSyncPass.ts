import type { CanonicalField } from '../canonicalField.js';
import type { Baseline } from './Baseline.js';
import type { RegisteredAdapter } from './RegisteredAdapter.js';
import type { SideObservation } from './SideObservation.js';

export class MirrorSyncPass {
  readonly entityId: string;
  readonly field: CanonicalField;
  readonly origin: SideObservation;
  readonly mirrors: readonly RegisteredAdapter[];
  readonly baselines: ReadonlyMap<string, Baseline>;

  constructor(init: {
    entityId: string;
    field: CanonicalField;
    origin: SideObservation;
    mirrors: readonly RegisteredAdapter[];
    baselines: ReadonlyMap<string, Baseline>;
  }) {
    this.entityId = init.entityId;
    this.field = init.field;
    this.origin = init.origin;
    this.mirrors = init.mirrors;
    this.baselines = init.baselines;
  }
}
