import type { Baseline } from './Baseline.js';
import type { OriginObservation } from './OriginObservation.js';
import { SideObservation } from './SideObservation.js';

export function mirrorSideKey(slug: string): string {
  return `mirror:${slug}`;
}

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
