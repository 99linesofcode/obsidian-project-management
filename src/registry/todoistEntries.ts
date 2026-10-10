import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskData } from '../shared/TaskData.js';

export interface MirrorEntry {
  handle: string;
  record: EntityRecord;
  base: TaskData | null;
}

export async function todoistEntries(
  syncState: SyncStatePort,
  connectionSlug: string,
  projectName: string,
): Promise<MirrorEntry[]> {
  const result: MirrorEntry[] = [];
  for (const { handle, item } of await syncState.listMirrorItems(
    projectName,
    connectionSlug,
  )) {
    const record = await syncState.getEntity(item.entityId);
    if (record !== null) {
      result.push({ handle, record, base: item.base });
    }
  }
  return result;
}
