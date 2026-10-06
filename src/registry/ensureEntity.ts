import type { SyncStatePort } from '../shared/SyncStatePort.js';

// The vault-owned uuid of a note, minted at record creation when absent. The
// registry is the id's home (dt-20): a note with no record gets a fresh entity
// before its mirror item is written.
export async function ensureEntity(
  syncState: SyncStatePort,
  notePath: string,
): Promise<string> {
  const existing = await syncState.findByNotePath(notePath);
  if (existing !== null) {
    return existing.id;
  }
  const id = crypto.randomUUID();
  await syncState.setEntity({ id, notePath });
  return id;
}
