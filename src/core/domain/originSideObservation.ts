import type { Baseline } from '../application/data/Baseline.js';
import type { OriginObservation } from '../application/data/OriginObservation.js';
import { SideObservation } from './SideObservation.js';

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
