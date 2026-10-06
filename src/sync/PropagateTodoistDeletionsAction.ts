import { TaskData } from '../shared/TaskData.js';
import type { EntityRecord, SyncStatePort } from '../registry/SyncStatePort.js';
import type { TaskManagerPort } from '../todoist/TaskManagerPort.js';
import type { VaultPort } from '../vault/VaultPort.js';

export interface PropagateTodoistDeletionsInput {
  projectName: string;
}

// One tracked record's todoist mirror: the hub entity, its twin handle and the
// last-synced base the parent walk reads.
interface TrackedRecord {
  record: EntityRecord;
  handle: string;
  base: TaskData | null;
}

// UC: propagate vault deletions to Todoist (t6, spec reconcile step 7). The
// vault is the source of truth (dt-05), so a mirrored note that is gone leaves
// its Todoist twin an orphan and the twin must go. Deletion is keyed on the
// NOTE's absence, never on the twin's absence from the fetched active set: a
// completed twin is absent from the active set too, and "completed" must never
// read as "deleted" (the completion action's cursor owns that distinction). A
// twin that is missing while its note survives is not a vault deletion either —
// the projection recreates it (vault wins).
//
// The API cascades a deleted parent's subtasks, so every record whose base
// parent chain leads to a deleted twin points at a twin that no longer exists;
// those records are evicted with it. A descendant whose note survives is
// re-created by the projection (vault wins) once its record is gone.
//
// Ordering is the echo guard: the twin is deleted BEFORE its record is evicted,
// so a capture pass can never observe an unanchored twin and re-capture it. A
// failed delete leaves the record in place and the next tick retries; the
// adapter treats a delete of an already-gone twin as a no-op, so the pair
// converges even if the twin was removed on the Todoist side first.
export class PropagateTodoistDeletionsAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: PropagateTodoistDeletionsInput): Promise<void> {
    // The project's todoist items joined to their hub entities: the item's
    // entityId is the hub reference now that the entity carries no handle.
    const records = await this.todoistRecords(input.projectName);
    if (records.length === 0) {
      return;
    }
    // A hub entity that still carries a github mirror is removed by the chain's
    // GitHub deletion sweep; its record removal is deferred below.
    const githubEntityIds = new Set<string>();
    for (const { item } of await this.syncState.listMirrorItems(
      input.projectName,
      'github',
    )) {
      githubEntityIds.add(item.entityId);
    }

    // A missing note is a vault deletion; a present one belongs to the
    // projection (and its self-heal), not here.
    const deleted: TrackedRecord[] = [];
    for (const tracked of records) {
      if ((await this.vault.getNoteByPath(tracked.record.notePath)) === null) {
        deleted.push(tracked);
      }
    }
    if (deleted.length === 0) {
      return;
    }

    const doomed = collectSubtrees(deleted, records);
    // Delete the twins first, then evict the records: eviction before a
    // successful delete would leave an unanchored twin a capture pass could
    // re-create, and a failed delete would strand a record it no longer owns.
    for (const tracked of deleted) {
      await this.taskManager.deleteTask(tracked.handle);
    }
    for (const tracked of doomed.values()) {
      if (githubEntityIds.has(tracked.record.id)) {
        continue;
      }
      await this.syncState.removeEntity(tracked.record.id);
    }
  }

  // The project's todoist items joined to their hub entities.
  private async todoistRecords(
    projectName: string,
  ): Promise<TrackedRecord[]> {
    const result: TrackedRecord[] = [];
    for (const { handle, item } of await this.syncState.listMirrorItems(
      projectName,
      'todoist',
    )) {
      const record = await this.syncState.getEntity(item.entityId);
      if (record !== null) {
        result.push({ record, handle, base: item.base });
      }
    }
    return result;
  }
}

// The deleted roots plus every record whose base parent chain leads to one of
// them — the subtree the API cascades away with the root twin. Parent links are
// uuids, so the walk keys on the entity id.
function collectSubtrees(
  roots: TrackedRecord[],
  records: TrackedRecord[],
): Map<string, TrackedRecord> {
  const childrenByParent = new Map<string, TrackedRecord[]>();
  for (const tracked of records) {
    const parent = tracked.base?.parent ?? null;
    if (parent === null) {
      continue;
    }
    const children = childrenByParent.get(parent) ?? [];
    children.push(tracked);
    childrenByParent.set(parent, children);
  }

  const doomed = new Map<string, TrackedRecord>();
  const visit = (tracked: TrackedRecord): void => {
    if (doomed.has(tracked.record.id)) {
      return;
    }
    doomed.set(tracked.record.id, tracked);
    for (const child of childrenByParent.get(tracked.record.id) ?? []) {
      visit(child);
    }
  };
  for (const root of roots) {
    visit(root);
  }
  return doomed;
}
