import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { Status } from '../Models/Status.js';

// The core's need for sync state: read and write a task note's Status record
// by its remote url, look it up by its note path (for deletes, when the note
// is gone), remove it, track the last poll cursor per project, and persist a
// project's resolved identities. The data.json-backed implementation lives in
// Infrastructure.
export interface SyncStatePort {
  get(url: string): Promise<Status | null>;
  set(status: Status): Promise<void>;
  findByNotePath(notePath: string): Promise<Status | null>;
  remove(url: string): Promise<void>;
  list(): Promise<Status[]>;
  getLastPoll(projectName: string): Promise<string | null>;
  setLastPoll(projectName: string, iso: string): Promise<void>;
  setIdentity(projectName: string, identity: ProjectIdentityData): Promise<void>;
  getIdentity(projectName: string): Promise<ProjectIdentityData | null>;
}
