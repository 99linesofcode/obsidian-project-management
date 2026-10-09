import type { EntityRecord } from '../data/EntityRecord.js';
import type { MirrorItem } from '../data/MirrorItem.js';

export interface TrackedEntityPort {
  listEntities(projectName: string): Promise<EntityRecord[]>;
  setEntity(record: EntityRecord): Promise<void>;
  findByNotePath(notePath: string): Promise<EntityRecord | null>;
  removeEntity(id: string): Promise<void>;
  findMirrorItemByEntity(
    connectionSlug: string,
    entityId: string,
  ): Promise<{ handle: string; item: MirrorItem } | null>;
}
