import type { SyncStatePort } from '../shared/SyncStatePort.js';

export async function parentUuid(
  syncState: SyncStatePort,
  connectionSlug: string,
  parentId: string | null,
): Promise<string | null> {
  if (parentId === null) {
    return null;
  }
  return (
    (await syncState.findMirrorItem(connectionSlug, parentId))?.entityId ?? null
  );
}
