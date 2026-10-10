import type { EntityRecord } from '../data/EntityRecord.js';
import type { MirrorItem } from '../data/MirrorItem.js';

export interface TrackedEntityPort {
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
}
