import type { MergedField } from '../domain/canonicalField.js';
import type { Baseline } from '../domain/Baseline.js';
import type { EntityRecord } from './data/EntityRecord.js';
import type { MirrorItem } from './data/MirrorItem.js';
import type { PortState } from './data/PortState.js';
import type { ProjectIdentityDataTransferObject } from './data/ProjectIdentityDataTransferObject.js';
import type { TombstoneRecord } from './data/TombstoneRecord.js';

export interface RegistryPort {
  getEntity(id: string): Promise<EntityRecord | null>;
  findByNotePath(notePath: string): Promise<EntityRecord | null>;
  setEntity(record: EntityRecord): Promise<void>;
  removeEntity(id: string): Promise<void>;
  listEntities(projectId: string): Promise<EntityRecord[]>;

  recordTombstone(record: TombstoneRecord): Promise<void>;
  removeTombstone(notePath: string): Promise<void>;
  findTombstoneByNotePath(notePath: string): Promise<TombstoneRecord | null>;
  findTombstone(handle: string): Promise<TombstoneRecord | null>;
  findMirrorItem(
    connectionSlug: string,
    handle: string,
  ): Promise<MirrorItem | null>;
  findMirrorItemByEntity(
    connectionSlug: string,
    entityId: string,
  ): Promise<{ handle: string; item: MirrorItem } | null>;
  setMirrorItem(
    projectId: string,
    connectionSlug: string,
    handle: string,
    item: MirrorItem,
  ): Promise<void>;
  removeMirrorItem(
    projectId: string,
    connectionSlug: string,
    handle: string,
  ): Promise<void>;
  listMirrorItems(
    projectId: string,
    connectionSlug: string,
  ): Promise<Array<{ handle: string; item: MirrorItem }>>;

  resolveMirrorHandle(
    connection: string,
    notePath: string,
  ): Promise<string | null>;
  listMirrorHandles(
    projectId: string,
    connection: string,
  ): Promise<readonly { handle: string; notePath: string }[]>;
  recordMirrorHandle(
    projectId: string,
    connection: string,
    notePath: string,
    handle: string,
  ): Promise<void>;

  resolveMirrorProject(
    projectId: string,
    connection: string,
  ): Promise<string | null>;
  recordMirrorProject(
    projectId: string,
    connection: string,
    application: string,
    handle: string,
  ): Promise<void>;

  getIdentity(
    projectId: string,
    connectionSlug: string,
  ): Promise<ProjectIdentityDataTransferObject | null>;
  setIdentity(
    projectId: string,
    connectionSlug: string,
    identity: ProjectIdentityDataTransferObject,
  ): Promise<void>;
  getPortState(
    projectId: string,
    connectionSlug: string,
  ): Promise<PortState | null>;
  setPortState(
    projectId: string,
    connectionSlug: string,
    state: PortState,
  ): Promise<void>;
  listPortStates(
    projectId: string,
  ): Promise<Array<{ slug: string; state: PortState }>>;
  rekeyPortState(
    projectId: string,
    fromSlug: string,
    toSlug: string,
  ): Promise<void>;

  readBaseline(
    entityId: string,
    field: MergedField,
    side: string,
  ): Promise<Baseline | null>;
  writeBaseline(
    entityId: string,
    field: MergedField,
    side: string,
    baseline: Baseline,
  ): Promise<void>;
}
