import type { MirrorPort } from '../../port/MirrorPort.js';

// A mirror trusts its per-field timestamps exactly when it exposes `fieldTime`:
// providing the method asserts the times it returns are decisive, and a null
// time is already ignored by the merge.
export function mirrorTrustsTimestamps(adapter: MirrorPort): boolean {
  return adapter.fieldTime !== undefined;
}

export function mirrorTrustsArchiveTime(
  adapter: MirrorPort,
  time: string | null,
): boolean {
  return adapter.projectTime !== undefined && time !== null;
}
