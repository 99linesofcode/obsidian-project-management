import { TaskData } from '../shared/TaskData.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskManagerPort } from '../shared/TaskManagerPort.js';
import type { VaultPort } from '../shared/VaultPort.js';

export interface PropagateTodoistDeletionsInput {
  projectName: string;
  connectionSlug: string;
  githubConnectionSlug: string | null;
}

interface TrackedRecord {
  record: EntityRecord;
  handle: string;
  base: TaskData | null;
}

export class PropagateTodoistDeletionsAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: PropagateTodoistDeletionsInput): Promise<void> {
    const records = await this.todoistRecords(
      input.projectName,
      input.connectionSlug,
    );
    if (records.length === 0) {
      return;
    }
    const githubEntityIds = new Set<string>();
    if (input.githubConnectionSlug !== null) {
      for (const { item } of await this.syncState.listMirrorItems(
        input.projectName,
        input.githubConnectionSlug,
      )) {
        githubEntityIds.add(item.entityId);
      }
    }

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

  private async todoistRecords(
    projectName: string,
    connectionSlug: string,
  ): Promise<TrackedRecord[]> {
    const result: TrackedRecord[] = [];
    for (const { handle, item } of await this.syncState.listMirrorItems(
      projectName,
      connectionSlug,
    )) {
      const record = await this.syncState.getEntity(item.entityId);
      if (record !== null) {
        result.push({ record, handle, base: item.base });
      }
    }
    return result;
  }
}

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
