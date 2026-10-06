import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskData } from '../shared/TaskData.js';

// One task-manager mirror item joined to its hub entity: the handle is the twin
// already in the registry, the record resolves the note path, and the base is
// the last-synced diff view. The join is the shape every task-manager absorber
// and the projection need, so it lives in one place.
export interface MirrorEntry {
  handle: string;
  record: EntityRecord;
  base: TaskData | null;
}

export async function todoistEntries(
  syncState: SyncStatePort,
  projectName: string,
): Promise<MirrorEntry[]> {
  const result: MirrorEntry[] = [];
  for (const { handle, item } of await syncState.listMirrorItems(
    projectName,
    'todoist',
  )) {
    const record = await syncState.getEntity(item.entityId);
    if (record !== null) {
      result.push({ handle, record, base: item.base });
    }
  }
  return result;
}
