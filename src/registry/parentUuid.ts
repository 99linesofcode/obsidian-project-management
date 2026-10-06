import type { SyncStatePort } from '../shared/SyncStatePort.js';

// The entity uuid a todoist twin id names, or null for a top-level item / an
// unanchored parent. The twin id is the todoist mirror handle.
export async function parentUuid(
  syncState: SyncStatePort,
  parentId: string | null,
): Promise<string | null> {
  if (parentId === null) {
    return null;
  }
  return (
    (await syncState.findMirrorItem('todoist', parentId))?.entityId ?? null
  );
}
