import type { ArchiveBaselineData } from '../DataTransferObjects/ArchiveBaselineData.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { TodoistProjectStateData } from '../DataTransferObjects/TodoistProjectStateData.js';
import type { WatchStateData } from '../DataTransferObjects/WatchStateData.js';

// The core's need for sync state: read and write a task note's canonical
// snapshot by its remote url, look it up by its note path (for deletes, when
// the note is gone), remove it, persist a project's resolved identities,
// remember the last remote updatedAt the poll saw for a project (the board-fetch
// gate), remember the last reconciled archive observation (the three-way merge
// baseline), remember an archived project's repository watch (the ETag and
// newest-issue cursor), remember a project's Todoist bookkeeping (its lane
// section map and completed-since cursor), remember a mirrored item's Todoist
// twin (its task id and last-synced canonical snapshot), and forget a twin's
// record when the twin (or the vault note that anchored it) is gone.
//
// The per-entity records are CANONICAL: `get`/`findByNotePath`/`list` and the
// Todoist accessors all return the canonical `TaskData` the mappers produce, so
// the pipeline reads one uniform shape rather than reassembling it from
// provider-shaped fragments. The data.json-backed implementation lives in
// Infrastructure.
export interface SyncStatePort {
  get(url: string): Promise<TaskData | null>;
  set(status: TaskData): Promise<void>;
  findByNotePath(notePath: string): Promise<TaskData | null>;
  remove(url: string): Promise<void>;
  list(): Promise<TaskData[]>;
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
  getTodoistState(notePath: string): Promise<TaskData | null>;
  setTodoistState(notePath: string, state: TaskData): Promise<void>;
  // Evicts a record cleanly. Deletion propagation needs a real removal: an
  // overwritten empty record would linger as a stale anchor, and a stale anchor
  // makes the next capture pass re-create the twin it should forget.
  removeTodoistState(notePath: string): Promise<void>;
  listTodoistStates(): Promise<TaskData[]>;
}
