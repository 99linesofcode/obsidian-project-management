import type { EntityRecord } from '../../src/core/port/data/EntityRecord.js';
import type { PortState } from '../../src/core/port/data/PortState.js';

export function entityRecord(
  overrides: Partial<EntityRecord> = {},
): EntityRecord {
  return {
    id: overrides.id ?? 'entity-uuid',
    notePath:
      overrides.notePath ?? 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
  };
}

export function portState(overrides: Partial<PortState> = {}): PortState {
  return {
    provider: overrides.provider ?? 'todoist',
    project: overrides.project ?? '',
    lastPoll: overrides.lastPoll ?? null,
    lanes: overrides.lanes ?? {},
  };
}
