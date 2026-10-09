import type { ArchiveBaselineData } from './ArchiveBaselineData.js';
import type { ProjectIdentityData } from './ProjectIdentityData.js';
import type { EntityRecord } from './data/EntityRecord.js';
import type { MirrorItem } from './data/MirrorItem.js';
import type { PortState } from './data/PortState.js';
import type { WatchStateData } from './WatchStateData.js';

export interface SyncStatePort {
  getEntity(id: string): Promise<EntityRecord | null>;
  findByNotePath(notePath: string): Promise<EntityRecord | null>;
  setEntity(record: EntityRecord): Promise<void>;
  removeEntity(id: string): Promise<void>;
  listEntities(projectName: string): Promise<EntityRecord[]>;

  findMirrorItem(
    connectionSlug: string,
    handle: string,
  ): Promise<MirrorItem | null>;
  findMirrorItemByEntity(
    connectionSlug: string,
    entityId: string,
  ): Promise<{ handle: string; item: MirrorItem } | null>;
  setMirrorItem(
    projectName: string,
    connectionSlug: string,
    handle: string,
    item: MirrorItem,
  ): Promise<void>;
  removeMirrorItem(
    projectName: string,
    connectionSlug: string,
    handle: string,
  ): Promise<void>;
  listMirrorItems(
    projectName: string,
    connectionSlug: string,
  ): Promise<Array<{ handle: string; item: MirrorItem }>>;

  getPortState(
    projectName: string,
    connectionSlug: string,
  ): Promise<PortState | null>;
  setPortState(
    projectName: string,
    connectionSlug: string,
    state: PortState,
  ): Promise<void>;
  listPortStates(
    projectName: string,
  ): Promise<Array<{ slug: string; state: PortState }>>;
  rekeyPortState(
    projectName: string,
    fromSlug: string,
    toSlug: string,
  ): Promise<void>;

  setIdentity(
    projectName: string,
    connectionSlug: string,
    identity: ProjectIdentityData,
  ): Promise<void>;
  getIdentity(
    projectName: string,
    connectionSlug: string,
  ): Promise<ProjectIdentityData | null>;
  listIdentities(
    projectName: string,
  ): Promise<Array<{ slug: string; identity: ProjectIdentityData }>>;
  getLastProjectUpdate(projectName: string): Promise<string | null>;
  setLastProjectUpdate(projectName: string, iso: string): Promise<void>;
  getArchiveBaseline(projectName: string): Promise<ArchiveBaselineData | null>;
  setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void>;
  getWatchState(projectName: string): Promise<WatchStateData>;
  setWatchState(projectName: string, state: WatchStateData): Promise<void>;

  isFullScanPending(projectName: string): Promise<boolean>;
  consumeFullScan(projectName: string): Promise<boolean>;

  getProjectCursor(portId: string): Promise<string | null>;
  setProjectCursor(portId: string, iso: string): Promise<void>;
}
