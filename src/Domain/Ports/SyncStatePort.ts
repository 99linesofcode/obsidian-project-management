import type { ArchiveBaselineData } from '../DataTransferObjects/ArchiveBaselineData.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { WatchStateData } from '../DataTransferObjects/WatchStateData.js';

// One hub entity's registry entry: its uuid and where its note lives. The
// mirrors map LEAVES the entity in v3 — the port items ARE the mirror state
// now, so an entity is hub-side location only.
export interface EntityRecord {
  id: string; // uuid — the key
  notePath: string; // current location of the note
}

// One mirror of a hub entity: the entity it belongs to (by reference, not
// duplication) and the last-synced snapshot the three-way diff arbitrates
// against. Items are children of their port, keyed by handle. The base is a
// DIFF VIEW: its body field carries the body's digest, never the full text.
export interface MirrorItem {
  entityId: string;
  base: TaskData | null;
}

// One port's per-project state. WHY these generic names: the schema never
// names a concrete service — `provider` is the dedicated field identifying
// the concrete service ('todoist', 'github', a future app), `lanes` is the
// generic term for board columns/sections, and `tags` for labels/categories
// (future). A provider name is a VALUE argument, never a namespace key.
export interface PortState {
  provider: string;
  lastPoll: string | null;
  lanes: Record<string, string>;
  tags: Record<string, string>;
}

// The core's need for sync state: project-nested, port-grouped storage. The
// registry replaces the two-store seam — the GitHub-keyed `status.*` store and
// the Todoist-twin `todoistItem.*` store — with one entity per hub and one
// item per mirror, grouped under the port that owns it. The data.json-backed
// implementation lives in Infrastructure.
export interface SyncStatePort {
  getEntity(id: string): Promise<EntityRecord | null>;
  findByNotePath(notePath: string): Promise<EntityRecord | null>;
  setEntity(record: EntityRecord): Promise<void>;
  removeEntity(id: string): Promise<void>;
  listEntities(projectName: string): Promise<EntityRecord[]>;

  findMirrorItem(portId: string, handle: string): Promise<MirrorItem | null>;
  setMirrorItem(
    projectName: string,
    portId: string,
    handle: string,
    item: MirrorItem,
  ): Promise<void>;
  removeMirrorItem(
    projectName: string,
    portId: string,
    handle: string,
  ): Promise<void>;
  listMirrorItems(
    projectName: string,
    portId: string,
  ): Promise<Array<{ handle: string; item: MirrorItem }>>;

  getPortState(
    projectName: string,
    portId: string,
  ): Promise<PortState | null>;
  setPortState(
    projectName: string,
    portId: string,
    state: PortState,
  ): Promise<void>;

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

  // One-shot: returns whether a full scan is pending and clears it. WHY: the
  // probe gate watches the project board's updatedAt, but issue-level relations
  // — sub-issues — move nothing on the board, so a store that predates parent
  // tracking needs exactly one forced fetch to discover them.
  consumeFullScan(): Promise<boolean>;
}
