import type { Baseline } from './data/Baseline.js';
import type { OriginObservation } from './data/OriginObservation.js';
import { SideObservation } from './data/SideObservation.js';

export function originSideObservation(
  side: string,
  baseline: Baseline | null,
  observation: OriginObservation,
): SideObservation {
  return new SideObservation({
    side,
    role: 'origin',
    current: observation.current,
    baseline,
    fieldTime: observation.fieldTime,
    timestampTrustworthy: observation.trustworthy,
    completeFetch: true,
    currentCompleted: observation.currentCompleted,
  });
}
