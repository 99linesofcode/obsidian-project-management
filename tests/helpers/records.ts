import { TaskData } from '../../src/shared/TaskData.js';
import type {
  EntityRecord,
  MirrorItem,
  PortState,
} from '../../src/shared/SyncStatePort.js';

export function taskData(overrides: Partial<TaskData> = {}): TaskData {
  return new TaskData({
    id: overrides.id ?? 'task-uuid',
    notePath:
      overrides.notePath ?? 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    mirrors: overrides.mirrors ?? {},
    title: overrides.title ?? 'Fix the bug',
    body: overrides.body ?? '',
    status: overrides.status ?? '',
    completedAt: overrides.completedAt ?? null,
    type: overrides.type ?? '',
    parent: overrides.parent ?? null,
    createdAt: overrides.createdAt ?? null,
    updatedAt: overrides.updatedAt ?? null,
  });
}

export function entityRecord(
  overrides: Partial<EntityRecord> = {},
): EntityRecord {
  return {
    id: overrides.id ?? 'entity-uuid',
    notePath:
      overrides.notePath ?? 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
  };
}

export function mirrorItem(
  entityId: string,
  base: TaskData | null = null,
): MirrorItem {
  return { entityId, base };
}

export function portState(overrides: Partial<PortState> = {}): PortState {
  return {
    provider: overrides.provider ?? 'todoist',
    project: overrides.project ?? '',
    lastPoll: overrides.lastPoll ?? null,
    lanes: overrides.lanes ?? {},
  };
}
