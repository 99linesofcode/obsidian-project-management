import type { EntityRecord } from '../../src/core/port/data/EntityRecord.js';
import type { PortState } from '../../src/core/port/data/PortState.js';
import { projectFromNotePath } from '../../src/core/domain/paths.js';

export function entityRecord(
  overrides: Partial<EntityRecord> = {},
): EntityRecord {
  const notePath =
    overrides.notePath ?? 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
  return {
    id: overrides.id ?? 'entity-uuid',
    notePath,
    projectId: overrides.projectId ?? projectFromNotePath(notePath),
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
