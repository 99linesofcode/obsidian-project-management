import type { ArchiveBaselineData } from '../DataTransferObjects/ArchiveBaselineData.js';
import type { Mirror } from '../DataTransferObjects/Mirror.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { TodoistProjectStateData } from '../DataTransferObjects/TodoistProjectStateData.js';
import type { WatchStateData } from '../DataTransferObjects/WatchStateData.js';

// One hub entity's sync state: identity, current location, and per-mirror
// handles + bases. The registry is the join point between halves.
export interface EntityRecord {
  id: string; // uuid — the key
  notePath: string; // current location of the note
  mirrors: Record<string, Mirror>; // provider name → { handle, base }
}

// The core's need for sync state: one registry record per hub entity (its uuid,
// where its note lives, and each mirror's handle + last-synced base), plus
// project-level bookkeeping. The registry replaces the two-store seam — the
// GitHub-keyed `status.*` store and the Todoist-twin `todoistItem.*` store —
// with one record per entity: the mirrors map records actuality (which mirrors
// exist and their addresses), not intent. The data.json-backed implementation
// lives in Infrastructure.
export interface SyncStatePort {
  get(id: string): Promise<EntityRecord | null>;
  findByNotePath(notePath: string): Promise<EntityRecord | null>;
  findByMirror(provider: string, handle: string): Promise<EntityRecord | null>;
  set(record: EntityRecord): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<EntityRecord[]>;
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
}
