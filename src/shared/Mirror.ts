import type { TaskData } from './TaskData.js';

// One mirror of a hub entity: its address in the remote plus the last-synced
// snapshot the three-way diff arbitrates against. Keyed by provider name in
// the record's mirrors map. The base is a DIFF VIEW: its body field carries
// the body's digest, never the full text.
export class Mirror {
  handle: string;
  base: TaskData | null;

  constructor(handle: string, base: TaskData | null) {
    this.handle = handle;
    this.base = base;
  }
}
