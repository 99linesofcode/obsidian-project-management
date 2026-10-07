import { TaskData } from '../../src/shared/TaskData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
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

export function todoistTask(
  overrides: Partial<TodoistTaskData> = {},
): TodoistTaskData {
  const id = overrides.id ?? 'T1';
  return {
    id,
    projectId: overrides.projectId ?? 'P1',
    sectionId: overrides.sectionId ?? null,
    parentId: overrides.parentId ?? null,
    content: overrides.content ?? 'Fix the bug',
    labels: overrides.labels ?? [],
    isCompleted: overrides.isCompleted ?? false,
    addedAt: overrides.addedAt ?? '',
    updatedAt: overrides.updatedAt ?? '',
    completedAt: overrides.completedAt ?? null,
  };
}
