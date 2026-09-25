import type { TodoistStateData } from '../DataTransferObjects/TodoistStateData.js';
import { isMirroredPath } from '../Notes/isMirroredPath.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface PropagateTodoistDeletionsInput {
  projectName: string;
}

// UC: propagate vault deletions to Todoist (t6, spec reconcile step 7). The
// vault is the source of truth (dt-05), so a mirrored note that is gone leaves
// its Todoist twin an orphan and the twin must go. Deletion is keyed on the
// NOTE's absence, never on the twin's absence from the fetched active set: a
// completed twin is absent from the active set too, and "completed" must never
// read as "deleted" (t4's completed-since cursor owns that distinction). A twin
// that is missing while its note survives is not a vault deletion either — the
// projection recreates it (vault wins).
//
// The API cascades a deleted parent's subtasks, so every record whose
// last-synced parent chain leads to a deleted twin points at a twin that no
// longer exists; those records are evicted with it. A descendant whose note
// survives is re-created by the projection (vault wins) once its record is
// gone.
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
    const states = (await this.syncState.listTodoistStates()).filter((state) =>
      isMirroredPath(state.notePath, input.projectName),
    );
    if (states.length === 0) {
      return;
    }

    // A missing note is a vault deletion; a present one belongs to the
    // projection (and its self-heal), not here.
    const deleted: TodoistStateData[] = [];
    for (const state of states) {
      if ((await this.vault.getNoteByPath(state.notePath)) === null) {
        deleted.push(state);
      }
    }
    if (deleted.length === 0) {
      return;
    }

    const doomed = collectSubtrees(deleted, states);
    // Delete the twins first, then evict the records: eviction before a
    // successful delete would leave an unanchored twin a capture pass could
    // re-create, and a failed delete would strand a record it no longer owns.
    for (const state of deleted) {
      await this.taskManager.deleteTask(state.todoistId);
    }
    for (const state of doomed.values()) {
      await this.syncState.removeTodoistState(state.notePath);
    }
  }
}

// The deleted roots plus every record whose last-synced parent chain leads to
// one of them — the subtree the API cascades away with the root twin.
function collectSubtrees(
  roots: TodoistStateData[],
  states: TodoistStateData[],
): Map<string, TodoistStateData> {
  const childrenByParent = new Map<string, TodoistStateData[]>();
  for (const state of states) {
    const parent = state.lastSyncedParent;
    if (parent === undefined || parent === null) {
      continue;
    }
    const children = childrenByParent.get(parent) ?? [];
    children.push(state);
    childrenByParent.set(parent, children);
  }

  const doomed = new Map<string, TodoistStateData>();
  const visit = (state: TodoistStateData): void => {
    if (doomed.has(state.notePath)) {
      return;
    }
    doomed.set(state.notePath, state);
    for (const child of childrenByParent.get(state.todoistId) ?? []) {
      visit(child);
    }
  };
  for (const root of roots) {
    visit(root);
  }
  return doomed;
}
