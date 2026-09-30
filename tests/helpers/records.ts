import { TaskData } from '../../src/Domain/DataTransferObjects/TaskData.js';
import type { TodoistTaskData } from '../../src/Domain/DataTransferObjects/TodoistTaskData.js';
import type {
  EntityRecord,
  MirrorItem,
  PortState,
} from '../../src/Domain/Ports/SyncStatePort.js';

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

// A hub entity: its uuid and where its note lives. The mirrors are NOT on the
// entity in v3 — a port item holds them.
export function entityRecord(
  overrides: Partial<EntityRecord> = {},
): EntityRecord {
  return {
    id: overrides.id ?? 'entity-uuid',
    notePath:
      overrides.notePath ?? 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
  };
}

// One mirror item: the hub entity it belongs to and its last-synced diff view.
export function mirrorItem(
  entityId: string,
  base: TaskData | null = null,
): MirrorItem {
  return { entityId, base };
}

// One port's per-project state, with provider-agnostic defaults.
export function portState(overrides: Partial<PortState> = {}): PortState {
  return {
    provider: overrides.provider ?? 'todoist',
    lastPoll: overrides.lastPoll ?? null,
    lanes: overrides.lanes ?? {},
    tags: overrides.tags ?? {},
  };
}

// A Todoist task with sensible defaults. The provider clocks default to empty
// strings so a test names only the field it cares about.
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
    url: overrides.url ?? `https://app.todoist.com/app/task/${id}`,
    addedAt: overrides.addedAt ?? '',
    updatedAt: overrides.updatedAt ?? '',
    completedAt: overrides.completedAt ?? null,
  };
}
