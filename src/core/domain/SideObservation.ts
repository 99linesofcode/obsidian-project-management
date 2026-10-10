import type { Baseline } from '../application/data/Baseline.js';

export type SideRole = 'origin' | 'mirror';

export class SideObservation {
  readonly side: string;
  readonly role: SideRole;
  readonly current: string | null;
  readonly baseline: Baseline | null;
  readonly fieldTime: string | null;
  readonly timestampTrustworthy: boolean;
  readonly completeFetch: boolean;
  readonly currentCompleted: boolean;

  constructor(init: {
    side: string;
    role: SideRole;
    current: string | null;
    baseline: Baseline | null;
    fieldTime: string | null;
    timestampTrustworthy: boolean;
    completeFetch: boolean;
    currentCompleted: boolean;
  }) {
    this.side = init.side;
    this.role = init.role;
    this.current = init.current;
    this.baseline = init.baseline;
    this.fieldTime = init.fieldTime;
    this.timestampTrustworthy = init.timestampTrustworthy;
    this.completeFetch = init.completeFetch;
    this.currentCompleted = init.currentCompleted;
  }
}
