import type { ArchiveBaselineData } from '../DataTransferObjects/ArchiveBaselineData.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { TodoistProjectStateData } from '../DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistStateData } from '../DataTransferObjects/TodoistStateData.js';
import type { WatchStateData } from '../DataTransferObjects/WatchStateData.js';
import type { Status } from '../Models/Status.js';

// The core's need for sync state: read and write a task note's Status record
// by its remote url, look it up by its note path (for deletes, when the note
// is gone), remove it, persist a project's resolved identities, remember the
// last remote updatedAt the poll saw for a project (the board-fetch gate),
// remember the last reconciled archive observation (the three-way merge
// baseline), remember an archived project's repository watch (the ETag and
// newest-issue cursor), remember a project's Todoist bookkeeping (its lane
// section map and completed-since cursor), remember a mirrored item's
// Todoist twin (its task id and last-synced snapshot hash), and forget a
// twin's record when the twin (or the vault note that anchored it) is gone.
// The data.json-backed implementation lives in Infrastructure.
export interface SyncStatePort {
  get(url: string): Promise<Status | null>;
  set(status: Status): Promise<void>;
  findByNotePath(notePath: string): Promise<Status | null>;
  remove(url: string): Promise<void>;
  list(): Promise<Status[]>;
  setIdentity(
    projectName: string,
    identity: ProjectIdentityData,
  ): Promise<void>;
  getIdentity(projectName: string): Promise<ProjectIdentityData | null>;
  getLastProjectUpdate(projectName: string): Promise<string | null>;
  setLastProjectUpdate(projectName: string, iso: string): Promise<void>;
  getArchiveBaseline(projectName: string): Promise<ArchiveBaselineData | null>;
  setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void>;
  getWatchState(projectName: string): Promise<WatchStateData>;
  setWatchState(projectName: string, state: WatchStateData): Promise<void>;
  getTodoistProjectState(
    projectName: string,
  ): Promise<TodoistProjectStateData | null>;
  setTodoistProjectState(
    projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void>;
  getTodoistState(notePath: string): Promise<TodoistStateData | null>;
  setTodoistState(notePath: string, state: TodoistStateData): Promise<void>;
  // Evicts a record cleanly. Deletion propagation (t6) needs a real removal:
  // an overwritten empty record would linger as a stale anchor, and a stale
  // anchor makes the next capture pass re-create the twin it should forget.
  removeTodoistState(notePath: string): Promise<void>;
  listTodoistStates(): Promise<TodoistStateData[]>;
}
