import type { ArchiveBaselineData } from '../projects/ArchiveBaselineData.js';
import type { ProjectIdentityData } from '../projects/ProjectIdentityData.js';
import type { TaskData } from './TaskData.js';
import type { WatchStateData } from '../projects/WatchStateData.js';

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
// the concrete service ('todoist', 'github', a future app), and `lanes` is the
// generic term for board columns/sections. A provider name is a VALUE
// argument, never a namespace key.
export interface PortState {
  provider: string;
  lastPoll: string | null;
  lanes: Record<string, string>;
}

// WHY this port lives in the shared kernel: it is the core's need, designed
// for the core and owned by no provider. Three modules consume it, so it
// belongs on neutral ground; the data.json-backed adapter registers from its
// own module.
//
// The core's need for sync state: project-nested, port-grouped storage. The
// registry replaces the two-store seam — the code-host-keyed `status.*` store and
// the task-manager-twin `todoistItem.*` store — with one entity per hub and one
// item per mirror, grouped under the port that owns it. The data.json-backed
// implementation lives in Infrastructure.
export interface SyncStatePort {
  getEntity(id: string): Promise<EntityRecord | null>;
  findByNotePath(notePath: string): Promise<EntityRecord | null>;
  setEntity(record: EntityRecord): Promise<void>;
  removeEntity(id: string): Promise<void>;
  listEntities(projectName: string): Promise<EntityRecord[]>;

  findMirrorItem(portId: string, handle: string): Promise<MirrorItem | null>;
  // The one item an entity holds in a port, or null. An entity has at most one
  // mirror per port, so this resolves without the caller scanning the project's
  // items.
  findMirrorItemByEntity(
    portId: string,
    entityId: string,
  ): Promise<{ handle: string; item: MirrorItem } | null>;
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

  // The one-shot forced-scan marker is PER PROJECT (projects.<name>.
  // fullScanPending). WHY: a single container-level flag was consumed by
  // whichever project synced first, so only that project got the parent-aware
  // fetch and every other project stayed blind to issue-level relations
  // (sub-issues) the board's updatedAt cannot surface (PRB-3).
  //
  // isFullScanPending is a read-only peek. The chain peeks before the code host
  // half and calls consumeFullScan only after that half succeeds, so a failed
  // or interrupted fetch never spends the scan.
  isFullScanPending(projectName: string): Promise<boolean>;
  // Clears the project's marker. Returns whether it was pending.
  consumeFullScan(projectName: string): Promise<boolean>;

  // The project-capture cursor for one remote SURFACE (portId 'todoist' or
  // 'github'): the newest provider creation clock seen at the last poll. A
  // remote project is captured only when it was created strictly after this
  // value, so pre-existing unrelated projects are never adopted (PRJ-2/PRJ-3).
  // WHY per-surface and not per-project: the cursor guards a global listing
  // (all of a user's task-manager projects, all of the viewer's boards), which has
  // no project to nest under; a first sight (null) adopts the current newest
  // clock and captures nothing.
  getProjectCursor(portId: string): Promise<string | null>;
  setProjectCursor(portId: string, iso: string): Promise<void>;
}
