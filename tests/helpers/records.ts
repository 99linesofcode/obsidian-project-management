import { Mirror } from '../../src/Domain/DataTransferObjects/Mirror.js';
import { TaskData } from '../../src/Domain/DataTransferObjects/TaskData.js';
import type { EntityRecord } from '../../src/Domain/Ports/SyncStatePort.js';

// A canonical task with sensible defaults, so a test names only the fields it
// cares about. TaskData is a class, so the factory constructs it: the registry,
// the diff views and the mappers all share one shape.
export function taskData(overrides: Partial<TaskData> = {}): TaskData {
  return new TaskData(
    overrides.id ?? 'task-uuid',
    overrides.notePath ?? 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    overrides.mirrors ?? {},
    overrides.title ?? 'Fix the bug',
    overrides.body ?? '',
    overrides.status ?? '',
    overrides.completedAt ?? null,
    overrides.type ?? '',
    overrides.parent ?? null,
    overrides.createdAt ?? null,
    overrides.updatedAt ?? null,
  );
}

// One mirror of a hub entity: an address plus its last-synced diff view.
export function mirror(handle: string, base: TaskData | null = null): Mirror {
  return new Mirror(handle, base);
}

// A registry record with sensible defaults, mirroring taskData. `mirrors` is a
// per-provider map of Mirror; an empty map is a not-yet-mirrored entity.
export function entityRecord(
  overrides: Partial<EntityRecord> = {},
): EntityRecord {
  return {
    id: overrides.id ?? 'entity-uuid',
    notePath:
      overrides.notePath ?? 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    mirrors: overrides.mirrors ?? {},
  };
}
