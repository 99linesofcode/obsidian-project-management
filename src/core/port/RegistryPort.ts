import type { MergedField } from '../domain/canonicalField.js';
import type { Baseline } from '../domain/Baseline.js';
import type { EntityRecord } from './data/EntityRecord.js';
import type { MirrorItem } from './data/MirrorItem.js';
import type { PortState } from './data/PortState.js';
import type { ProjectIdentityDataTransferObject } from './data/ProjectIdentityDataTransferObject.js';

// The registry as the core's sync state: the tracked entities and their mirror
// items, the note-path↔handle and mirror-project mappings, the per-connection
// identity and port bookkeeping, and the side baselines. One collaborator, one
// surface of registry primitives — the handle and mirror-project resolution
// compose the raw registry reads here, never in a use case, and the adapter
// starts no use case.
export interface RegistryPort {
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

  // The core's need: map a vault entity to the handle its mirror item carries,
  // remember a handle once the mirror item exists, and enumerate the handles a
  // connection already holds for a project. The core never sees a provider's
  // identifier shape — the adapter owns that.
  resolveMirrorHandle(
    connection: string,
    notePath: string,
  ): Promise<string | null>;
  listMirrorHandles(
    project: string,
    connection: string,
  ): Promise<readonly { handle: string; notePath: string }[]>;
  // Records the handle for the entity, replacing any handle already recorded
  // for it on this connection. A placeholder recorded before creation is
  // replaced by the real handle once the mirror item exists.
  recordMirrorHandle(
    project: string,
    connection: string,
    notePath: string,
    handle: string,
  ): Promise<void>;

  // The core's need to resolve and record the handle a connection's
  // application uses for the mirror project — the project-level peer of the
  // mirror-handle mapping. Designed for the core, not the provider's API.
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
