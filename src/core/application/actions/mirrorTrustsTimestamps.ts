import type { MirrorPort } from '../../port/MirrorPort.js';

export function mirrorTrustsTimestamps(adapter: MirrorPort): boolean {
  return adapter.fieldTime !== undefined;
}

export function mirrorTrustsArchiveTime(
  adapter: MirrorPort,
  time: string | null,
): boolean {
  return adapter.projectTime !== undefined && time !== null;
}
