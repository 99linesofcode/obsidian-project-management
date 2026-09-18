import type { Status } from '../Models/Status.js';

// The core's need for sync state: read and write a task note's Status record
// by its remote url. The data.json-backed implementation lands later.
export interface SyncStatePort {
  get(url: string): Promise<Status | null>;
  set(status: Status): Promise<void>;
}
