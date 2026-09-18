import type { Status } from '../Models/Status.js';

// The core's need for sync state: read and write a task note's Status record
// by its remote url, and track the last poll cursor per project. The
// data.json-backed implementation lives in Infrastructure.
export interface SyncStatePort {
  get(url: string): Promise<Status | null>;
  set(status: Status): Promise<void>;
  getLastPoll(projectName: string): Promise<string | null>;
  setLastPoll(projectName: string, iso: string): Promise<void>;
}
