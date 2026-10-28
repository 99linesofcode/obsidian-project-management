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
  listEntities(projectName: string): Promise<EntityRecord[]>;

  rekeyProject(fromProject: string, toProject: string): Promise<void>;
  hasProject(projectName: string): Promise<boolean>;
  listProjects(): Promise<string[]>;

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

  resolveMirrorHandle(
    connection: string,
    notePath: string,
  ): Promise<string | null>;
  listMirrorHandles(
    project: string,
    connection: string,
  ): Promise<readonly { handle: string; notePath: string }[]>;
  recordMirrorHandle(
    project: string,
    connection: string,
    notePath: string,
    handle: string,
  ): Promise<void>;

  resolveMirrorProject(
    project: string,
    connection: string,
  ): Promise<string | null>;
  recordMirrorProject(
    project: string,
    connection: string,
    application: string,
    handle: string,
  ): Promise<void>;

  getIdentity(
    projectName: string,
    connectionSlug: string,
  ): Promise<ProjectIdentityDataTransferObject | null>;
  setIdentity(
    projectName: string,
    connectionSlug: string,
    identity: ProjectIdentityDataTransferObject,
  ): Promise<void>;
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
