import type { MirrorPort } from '../port/MirrorPort.js';

export interface ResolvedMirror {
  slug: string;
  side: string;
  handle: string;
  adapter: MirrorPort;
}
