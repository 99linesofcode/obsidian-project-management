import { isRecord } from '../shared/isRecord.js';
import { projectFromNotePath } from '../projects/projectFromNotePath.js';
import type { ArchiveBaselineData } from '../shared/ArchiveBaselineData.js';
import { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { WatchStateData } from '../shared/WatchStateData.js';
import type {
  EntityRecord,
  MirrorItem,
  PortState,
  SyncStatePort,
} from '../shared/SyncStatePort.js';
import {
  FULL_SCAN_PENDING_KEY,
  PROJECT_CURSORS_KEY,
  SYNC_STATE_KEY,
  VERSION,
  ensureEntityMap,
  ensureIdentitiesMap,
  ensureItemsMap,
  ensurePortNode,
  ensureProjectNode,
  ensureProjects,
  entityMap,
  identitiesMap,
  itemsMap,
  mapMirrorItem,
  mapPortState,
  portNode,
  portsMap,
  projectNode,
  readProjectsMap,
  str,
} from './SyncStateSchema.js';

// The storage the adapter persists through. main.ts binds the plugin's
// loadData/saveData so records live in the plugin's data.json.
export interface SyncStateStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
  // Optional best-effort snapshot of the current data file, taken before an
  // overwrite so a crash mid-write can fall back to the previous state. Absent
  // when the platform cannot copy the file.
  backup?(): Promise<void>;
}

// The adapter asks for a rolling backup before a registry overwrite, but at
// most once per window: a burst of port ops during one sync pass must not copy
// data.json on every write.
const BACKUP_MIN_INTERVAL_MS = 60_000;

// Re-exported so the plugin's existing importers keep one entry point.
export { SYNC_STATE_KEY } from './SyncStateSchema.js';

// One port item's location, tracked so `removeEntity` can sweep an entity's
// mirrors without scanning every project.
interface ItemRef {
  project: string;
  portId: string;
  handle: string;
  entityId: string;
}

// A (portId, handle) owner, tracked so `findMirrorItem` resolves without a scan
// and `setMirrorItem` can re-point an address without destroying its previous
// owner.
interface HandleOwner {
  project: string;
  entityId: string;
}

// The in-memory lookup indexes, rebuilt once from the container on first load
// and maintained on every write afterwards.
interface Indexes {
  byNotePath: Map<string, string>;
  byEntityPath: Map<string, string>;
  byEntityProject: Map<string, string>;
  byHandle: Map<string, Map<string, HandleOwner>>;
  itemsByEntity: Map<string, ItemRef[]>;
}

function emptyIndexes(): Indexes {
  return {
    byNotePath: new Map(),
    byEntityPath: new Map(),
    byEntityProject: new Map(),
    byHandle: new Map(),
    itemsByEntity: new Map(),
  };
}

function buildIndexes(container: Record<string, unknown>): Indexes {
  const indexes = emptyIndexes();
  for (const [projectName, rawProject] of Object.entries(
    readProjectsMap(container),
  )) {
    if (!isRecord(rawProject)) {
      continue;
    }
    for (const [id, raw] of Object.entries(entityMap(rawProject))) {
      if (!isRecord(raw)) {
        continue;
      }
      const notePath = str(raw.notePath);
      indexes.byNotePath.set(notePath, id);
      indexes.byEntityPath.set(id, notePath);
      indexes.byEntityProject.set(id, projectName);
    }
    for (const [portId, rawPort] of Object.entries(portsMap(rawProject))) {
      if (!isRecord(rawPort)) {
        continue;
      }
      for (const [handle, rawItem] of Object.entries(itemsMap(rawPort))) {
        if (!isRecord(rawItem)) {
          continue;
        }
        const entityId = str(rawItem.entityId);
        let handles = indexes.byHandle.get(portId);
        if (handles === undefined) {
          handles = new Map();
          indexes.byHandle.set(portId, handles);
        }
        handles.set(handle, { project: projectName, entityId });
        const refs = indexes.itemsByEntity.get(entityId) ?? [];
        refs.push({ project: projectName, portId, handle, entityId });
        indexes.itemsByEntity.set(entityId, refs);
      }
    }
  }
  return indexes;
}

// Deletes one port item from the container and clears its index entries.
function dropItem(
  container: Record<string, unknown>,
  indexes: Indexes,
  ref: ItemRef,
): void {
  const node = projectNode(readProjectsMap(container), ref.project);
  if (node !== null) {
    const port = portNode(node, ref.portId);
    if (port !== null) {
      const items = itemsMap(port);
      if (items[ref.handle] !== undefined) {
        delete items[ref.handle];
      }
    }
  }
  const handles = indexes.byHandle.get(ref.portId);
  if (
    handles !== undefined &&
    handles.get(ref.handle)?.entityId === ref.entityId
  ) {
    handles.delete(ref.handle);
    if (handles.size === 0) {
      indexes.byHandle.delete(ref.portId);
    }
  }
}

// Removes an entity and every index entry that pointed at it, including the
// mirror items it owned in each port (the sweep that keeps the ports from
// stranding items whose hub is gone).
function dropEntity(
  container: Record<string, unknown>,
  indexes: Indexes,
  id: string,
): void {
  const project = indexes.byEntityProject.get(id);
  const path = indexes.byEntityPath.get(id);
  if (project !== undefined) {
    const node = projectNode(readProjectsMap(container), project);
    if (node !== null) {
      const entities = entityMap(node);
      if (entities[id] !== undefined) {
        delete entities[id];
      }
    }
  }
  if (path !== undefined && indexes.byNotePath.get(path) === id) {
    indexes.byNotePath.delete(path);
  }
  indexes.byEntityPath.delete(id);
  indexes.byEntityProject.delete(id);
  for (const ref of indexes.itemsByEntity.get(id) ?? []) {
    dropItem(container, indexes, ref);
  }
  indexes.itemsByEntity.delete(id);
}

// Deletes one port item node without touching the indexes (the caller owns the
// index bookkeeping). Used when an address changes hands or moves project.
function removeItemNode(
  container: Record<string, unknown>,
  project: string,
  portId: string,
  handle: string,
): void {
  const node = projectNode(readProjectsMap(container), project);
  if (node === null) {
    return;
  }
  const port = portNode(node, portId);
  if (port === null) {
    return;
  }
  const items = itemsMap(port);
  if (items[handle] !== undefined) {
    delete items[handle];
  }
}

// Drops one entity's reverse-index ref to a (portId, handle) address. A handle
// is port-unique, so matching on portId+handle is enough. Keeps a re-pointed
// item from later being swept as if it were still the old owner's.
function removeItemRef(
  indexes: Indexes,
  entityId: string,
  portId: string,
  handle: string,
): void {
  const refs = indexes.itemsByEntity.get(entityId);
  if (refs === undefined) {
    return;
  }
  const filtered = refs.filter(
    (ref) => !(ref.portId === portId && ref.handle === handle),
  );
  if (filtered.length === 0) {
    indexes.itemsByEntity.delete(entityId);
  } else {
    indexes.itemsByEntity.set(entityId, filtered);
  }
}

// Tracks one entity's ref to an address when it is not already present, so
// setMirrorItem never double-counts a (portId, handle).
function addItemRef(
  indexes: Indexes,
  entityId: string,
  project: string,
  portId: string,
  handle: string,
): void {
  const refs = indexes.itemsByEntity.get(entityId) ?? [];
  if (
    !refs.some(
      (ref) =>
        ref.project === project &&
        ref.portId === portId &&
        ref.handle === handle,
    )
  ) {
    refs.push({ project, portId, handle, entityId });
    indexes.itemsByEntity.set(entityId, refs);
  }
}

// Moves an entity's port item nodes from one project to another, so an
// entity's items always live under the same project as the entity. The handle
// owners and the reverse index are updated in step; the caller removes the old
// entity node afterwards. Only refs still recorded under the old project move
// (a ref already re-pointed by setMirrorItem is left alone).
function relocateItems(
  container: Record<string, unknown>,
  indexes: Indexes,
  entityId: string,
  fromProject: string,
  toProject: string,
): void {
  const fromNode = projectNode(readProjectsMap(container), fromProject);
  for (const ref of indexes.itemsByEntity.get(entityId) ?? []) {
    if (ref.project !== fromProject) {
      continue;
    }
    let raw: unknown;
    if (fromNode !== null) {
      const port = portNode(fromNode, ref.portId);
      if (port !== null) {
        const items = itemsMap(port);
        raw = items[ref.handle];
        if (raw !== undefined) {
          delete items[ref.handle];
        }
      }
    }
    if (raw === undefined) {
      continue;
    }
    const toNode = ensureProjectNode(ensureProjects(container), toProject);
    const toPort = ensurePortNode(toNode, ref.portId);
    // A relocated item stamps the destination port's provider the same way a
    // fresh item does.
    if (typeof toPort.provider !== 'string' || toPort.provider === '') {
      toPort.provider = ref.portId;
    }
    ensureItemsMap(toPort)[ref.handle] = raw;
    ref.project = toProject;
    indexes.byHandle.get(ref.portId)?.set(ref.handle, {
      project: toProject,
      entityId,
    });
  }
}

// Implements the sync state port against a namespaced key/value store. Storage
// is project-nested and port-grouped: the entity holds only hub-side location;
// each port holds its items keyed by handle. The adapter is the single writer:
// every port method runs through an in-process promise chain and shares one
// cached container, so two interleaved load-modify-save operations cannot each
// persist a stale snapshot and lose one write (REG-2). The container is read
// once and written through, instead of re-parsed per op.
export class SyncStateAdapter implements SyncStatePort {
  private indexes: Indexes | null = null;
  private container: Record<string, unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastBackupAt: number | null = null;
  // Set when the loaded container was written by a NEWER plugin version. Its
  // schema is not ours to rewrite, so every mutating port method refuses: a
  // downgrade would persist the newer layout in the old shape and corrupt it.
  private readOnly = false;

  constructor(private readonly storage: SyncStateStorage) {}

  // The mutex every port method funnels through. External callers always chain,
  // so a command racing a sync pass cannot interleave a load-modify-save. No
  // port method calls another (the one shared lookup is a private helper), so
  // there is no nested queue call to deadlock on. A rejected op does not poison
  // the chain.
  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(
      () => fn(),
      () => fn(),
    );
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // Refuses a mutation against a container written by a newer plugin version.
  // WHY throw instead of silently skipping: a silent skip would let the sync
  // pass believe its writes landed, and the newer schema would never be
  // corrupted but the divergence would be invisible. The caller's step isolation
  // logs the refusal and retries after the user upgrades.
  private assertWritable(): void {
    if (this.readOnly) {
      throw new Error(
        'registry written by a newer plugin version — refusing to mutate',
      );
    }
  }

  // A serialized mutation of the data.json ROOT for the plugin's non-registry
  // writers (settings). It runs on the SAME promise chain as every port method,
  // so a settings save and a registry write can never interleave their
  // load-modify-save and lose one (REG-2/REG-3). The caller's function receives
  // a fresh root and returns the root to persist; the registry container rides
  // along from that fresh read, never from the adapter's cache, so the two
  // writers share one file without sharing one snapshot. WHY not a port method:
  // settings are the composition root's concern, and the registry port owns
  // registry state, not the root's other keys.
  mutateRoot(
    fn: (
      root: Record<string, unknown>,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): Promise<void> {
    return this.queue(async () => {
      // Ensure the container is loaded (and migrations run) before the root is
      // touched, so the settings write never lands ahead of the first registry
      // load. A newer container is deliberately not asserted writable here:
      // saving settings must still work, and this method never rewrites the
      // registry container.
      await this.loadContainer();
      const data = await this.storage.load();
      const next = await fn(data);
      await this.storage.save(next);
    });
  }

  // The namespaced container. The container and its indexes are cached; every
  // later read and write goes through the cache, so concurrent ops share one
  // object. A container written by an OLDER schema is reset rather than
  // migrated: under the alpha ruling the registry is disposable and the vault
  // re-syncs from scratch.
  private async loadContainer(): Promise<Record<string, unknown>> {
    if (this.container !== null) {
      return this.container;
    }
    const data = await this.storage.load();
    const container = isRecord(data[SYNC_STATE_KEY])
      ? data[SYNC_STATE_KEY]
      : {};
    if (!isRecord(data[SYNC_STATE_KEY])) {
      data[SYNC_STATE_KEY] = container;
    }
    const version = container.version;
    if (typeof version === 'number' && version > VERSION) {
      // A NEWER container is never rewritten: its schema is not ours, and a
      // downgrade would corrupt it. Leave it byte-for-byte and note it. Reads
      // still serve whatever the newer layout holds; writes are refused below
      // so the newer layout is never persisted in the old shape.
      this.readOnly = true;
      console.warn(
        `SyncStateAdapter: registry version ${version} is newer than supported ${VERSION}; leaving it untouched`,
      );
    } else if (version !== VERSION) {
      for (const key of Object.keys(container)) {
        delete container[key];
      }
      container.version = VERSION;
      await this.maybeBackup();
      data[SYNC_STATE_KEY] = container;
      await this.storage.save(data);
    }
    this.indexes = buildIndexes(container);
    this.container = container;
    return container;
  }

  // Writes the cached container through to a FRESH data.json root, so keys
  // owned by other writers (settings) survive. Asks for a rolling backup before
  // the overwrite so a crash mid-write leaves the previous state on disk.
  private async persist(): Promise<void> {
    await this.maybeBackup();
    const data = await this.storage.load();
    data[SYNC_STATE_KEY] = this.container;
    await this.storage.save(data);
  }

  private async maybeBackup(): Promise<void> {
    const now = Date.now();
    if (
      this.lastBackupAt !== null &&
      now - this.lastBackupAt < BACKUP_MIN_INTERVAL_MS
    ) {
      return;
    }
    this.lastBackupAt = now;
    try {
      await this.storage.backup?.();
    } catch {
      // Best-effort: a failed backup must never block a registry write.
    }
  }

  async getEntity(id: string): Promise<EntityRecord | null> {
    return this.queue(() => this.getEntityUnsafe(id));
  }

  // The shared lookup, called from within an already-queued method so the two
  // never nest on the queue.
  private async getEntityUnsafe(id: string): Promise<EntityRecord | null> {
    const container = await this.loadContainer();
    const project = this.indexes!.byEntityProject.get(id);
    if (project === undefined) {
      return null;
    }
    const node = projectNode(readProjectsMap(container), project);
    if (node === null) {
      return null;
    }
    const raw = entityMap(node)[id];
    return isRecord(raw) ? { id, notePath: str(raw.notePath) } : null;
  }

  async findByNotePath(notePath: string): Promise<EntityRecord | null> {
    return this.queue(async () => {
      await this.loadContainer();
      const id = this.indexes!.byNotePath.get(notePath);
      return id === undefined ? null : this.getEntityUnsafe(id);
    });
  }

  async setEntity(record: EntityRecord): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      const indexes = this.indexes!;
      // The project key is derived from the note path (Projecten/<name>/... and
      // Archief/<name>/... both key <name>); WHY: the path convention IS the
      // project partition, so no caller has to pass the name for an entity.
      const project = projectFromNotePath(record.notePath);
      const previousProject = indexes.byEntityProject.get(record.id);
      const previousPath = indexes.byEntityPath.get(record.id);

      // A notePath resolves to exactly one entity: claiming an occupied path
      // evicts the previous owner — its record AND its mirror items — so the
      // path index can never hold two owners.
      const occupant = indexes.byNotePath.get(record.notePath);
      if (occupant !== undefined && occupant !== record.id) {
        dropEntity(container, indexes, occupant);
      }

      // Re-key: drop the old path index before writing the new location.
      if (
        previousPath !== undefined &&
        previousPath !== record.notePath &&
        indexes.byNotePath.get(previousPath) === record.id
      ) {
        indexes.byNotePath.delete(previousPath);
      }
      // A project move relocates the entity's item nodes to the new project's
      // ports and updates the handle/reverse indexes, so an entity's items never
      // strand under the old project and the handle index never desyncs.
      if (previousProject !== undefined && previousProject !== project) {
        relocateItems(container, indexes, record.id, previousProject, project);
        const oldNode = projectNode(
          readProjectsMap(container),
          previousProject,
        );
        if (oldNode !== null) {
          const oldEntities = entityMap(oldNode);
          if (oldEntities[record.id] !== undefined) {
            delete oldEntities[record.id];
          }
        }
      }

      const node = ensureProjectNode(ensureProjects(container), project);
      ensureEntityMap(node)[record.id] = { notePath: record.notePath };
      indexes.byNotePath.set(record.notePath, record.id);
      indexes.byEntityPath.set(record.id, record.notePath);
      indexes.byEntityProject.set(record.id, project);
      await this.persist();
    });
  }

  async removeEntity(id: string): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      dropEntity(container, this.indexes!, id);
      await this.persist();
    });
  }

  async listEntities(projectName: string): Promise<EntityRecord[]> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      if (node === null) {
        return [];
      }
      return Object.entries(entityMap(node))
        .filter(([, raw]) => isRecord(raw))
        .map(([id, raw]) => ({
          id,
          notePath: str((raw as Record<string, unknown>).notePath),
        }));
    });
  }

  async findMirrorItem(
    portId: string,
    handle: string,
  ): Promise<MirrorItem | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const owner = this.indexes!.byHandle.get(portId)?.get(handle);
      if (owner === undefined) {
        return null;
      }
      const node = projectNode(readProjectsMap(container), owner.project);
      if (node === null) {
        return null;
      }
      const port = portNode(node, portId);
      if (port === null) {
        return null;
      }
      return mapMirrorItem(itemsMap(port)[handle]);
    });
  }

  async findMirrorItemByEntity(
    portId: string,
    entityId: string,
  ): Promise<{ handle: string; item: MirrorItem } | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const ref = (this.indexes!.itemsByEntity.get(entityId) ?? []).find(
        (candidate) => candidate.portId === portId,
      );
      if (ref === undefined) {
        return null;
      }
      const node = projectNode(readProjectsMap(container), ref.project);
      if (node === null) {
        return null;
      }
      const port = portNode(node, portId);
      if (port === null) {
        return null;
      }
      const item = mapMirrorItem(itemsMap(port)[ref.handle]);
      return item === null ? null : { handle: ref.handle, item };
    });
  }

  async setMirrorItem(
    projectName: string,
    portId: string,
    handle: string,
    item: MirrorItem,
  ): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      const indexes = this.indexes!;

      // A (portId, handle) address has exactly one owner. Re-pointing it does
      // NOT destroy the previous owner: promise 2 — no change is ever lost. The
      // previous entity keeps its record and every OTHER mirror; only this
      // address changes hands. Supersession is deliberate and explicit, via
      // removeEntity — never a side effect of an address write (REG-6).
      const owner = indexes.byHandle.get(portId)?.get(handle);
      if (owner !== undefined) {
        if (owner.project !== projectName) {
          // The same address now lives under another project: drop the stale
          // node and its reverse ref before writing the new one.
          removeItemNode(container, owner.project, portId, handle);
          removeItemRef(indexes, owner.entityId, portId, handle);
        } else if (owner.entityId !== item.entityId) {
          removeItemRef(indexes, owner.entityId, portId, handle);
        }
      }

      const node = ensureProjectNode(ensureProjects(container), projectName);
      const port = ensurePortNode(node, portId);
      // A port's provider is its concrete service; a first item stamps it when
      // the caller has not written a port state yet.
      if (typeof port.provider !== 'string' || port.provider === '') {
        port.provider = portId;
      }
      ensureItemsMap(port)[handle] = {
        entityId: item.entityId,
        base: item.base,
      };

      let handles = indexes.byHandle.get(portId);
      if (handles === undefined) {
        handles = new Map();
        indexes.byHandle.set(portId, handles);
      }
      handles.set(handle, { project: projectName, entityId: item.entityId });

      addItemRef(indexes, item.entityId, projectName, portId, handle);
      await this.persist();
    });
  }

  async removeMirrorItem(
    projectName: string,
    portId: string,
    handle: string,
  ): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      const node = projectNode(readProjectsMap(container), projectName);
      const port = node === null ? null : portNode(node, portId);
      if (port !== null) {
        const raw = itemsMap(port)[handle];
        if (isRecord(raw)) {
          const entityId = str(raw.entityId);
          dropItem(container, this.indexes!, {
            project: projectName,
            portId,
            handle,
            entityId,
          });
          removeItemRef(this.indexes!, entityId, portId, handle);
        }
      }
      await this.persist();
    });
  }

  async listMirrorItems(
    projectName: string,
    portId: string,
  ): Promise<Array<{ handle: string; item: MirrorItem }>> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      if (node === null) {
        return [];
      }
      const port = portNode(node, portId);
      if (port === null) {
        return [];
      }
      const result: Array<{ handle: string; item: MirrorItem }> = [];
      for (const [handle, raw] of Object.entries(itemsMap(port))) {
        const item = mapMirrorItem(raw);
        if (item !== null) {
          result.push({ handle, item });
        }
      }
      return result;
    });
  }

  async getPortState(
    projectName: string,
    portId: string,
  ): Promise<PortState | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      if (node === null) {
        return null;
      }
      const port = portNode(node, portId);
      return port === null ? null : mapPortState(port, portId);
    });
  }

  async setPortState(
    projectName: string,
    portId: string,
    state: PortState,
  ): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      const node = ensureProjectNode(ensureProjects(container), projectName);
      const port = ensurePortNode(node, portId);
      port.provider = state.provider;
      port.project = state.project;
      port.lastPoll = state.lastPoll;
      port.lanes = state.lanes;
      await this.persist();
    });
  }

  async listPortStates(
    projectName: string,
  ): Promise<Array<{ slug: string; state: PortState }>> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      if (node === null) {
        return [];
      }
      const result: Array<{ slug: string; state: PortState }> = [];
      for (const [slug, raw] of Object.entries(portsMap(node))) {
        if (isRecord(raw)) {
          result.push({ slug, state: mapPortState(raw, slug) });
        }
      }
      return result;
    });
  }

  // Moves a project's whole port (state and mirror items) from one slug to
  // another in ONE persist. The handle and reverse indexes are re-keyed in
  // step, so a renamed connection's mirrors stay resolvable.
  async rekeyPortState(
    projectName: string,
    fromSlug: string,
    toSlug: string,
  ): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      if (fromSlug === toSlug) {
        return;
      }
      const node = projectNode(readProjectsMap(container), projectName);
      if (node === null) {
        return;
      }
      const ports = portsMap(node);
      const raw = ports[fromSlug];
      if (!isRecord(raw)) {
        return;
      }
      ports[toSlug] = raw;
      delete ports[fromSlug];

      const indexes = this.indexes!;
      // Move only THIS project's handles. The handle index is shared across
      // projects, so moving the whole slug bucket would re-point every other
      // project's handles for that slug and break their resolution until the
      // next reload.
      const fromHandles = indexes.byHandle.get(fromSlug);
      if (fromHandles !== undefined) {
        let toHandles = indexes.byHandle.get(toSlug);
        if (toHandles === undefined) {
          toHandles = new Map();
          indexes.byHandle.set(toSlug, toHandles);
        }
        for (const [handle, owner] of [...fromHandles]) {
          if (owner.project !== projectName) {
            continue;
          }
          fromHandles.delete(handle);
          toHandles.set(handle, owner);
        }
        if (fromHandles.size === 0) {
          indexes.byHandle.delete(fromSlug);
        }
      }
      for (const refs of indexes.itemsByEntity.values()) {
        for (const ref of refs) {
          if (ref.project === projectName && ref.portId === fromSlug) {
            ref.portId = toSlug;
          }
        }
      }
      await this.persist();
    });
  }

  async setIdentity(
    projectName: string,
    connectionSlug: string,
    identity: ProjectIdentityData,
  ): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      const node = ensureProjectNode(ensureProjects(container), projectName);
      ensureIdentitiesMap(node)[connectionSlug] = identity;
      await this.persist();
    });
  }

  async getIdentity(
    projectName: string,
    connectionSlug: string,
  ): Promise<ProjectIdentityData | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      const raw =
        node === null ? undefined : identitiesMap(node)[connectionSlug];
      return isRecord(raw) ? this.mapIdentity(raw) : null;
    });
  }

  async listIdentities(
    projectName: string,
  ): Promise<Array<{ slug: string; identity: ProjectIdentityData }>> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      if (node === null) {
        return [];
      }
      const result: Array<{ slug: string; identity: ProjectIdentityData }> = [];
      for (const [slug, raw] of Object.entries(identitiesMap(node))) {
        if (isRecord(raw)) {
          result.push({ slug, identity: this.mapIdentity(raw) });
        }
      }
      return result;
    });
  }

  async getLastProjectUpdate(projectName: string): Promise<string | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      const raw = node === null ? undefined : node.lastProjectUpdate;
      return typeof raw === 'string' ? raw : null;
    });
  }

  async setLastProjectUpdate(projectName: string, iso: string): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      ensureProjectNode(
        ensureProjects(container),
        projectName,
      ).lastProjectUpdate = iso;
      await this.persist();
    });
  }

  async getArchiveBaseline(
    projectName: string,
  ): Promise<ArchiveBaselineData | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      const raw = node === null ? undefined : node.archive;
      return isRecord(raw) ? this.mapArchiveBaseline(raw) : null;
    });
  }

  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      ensureProjectNode(ensureProjects(container), projectName).archive =
        baseline;
      await this.persist();
    });
  }

  private mapArchiveBaseline(
    raw: Record<string, unknown>,
  ): ArchiveBaselineData {
    const locationArchived = raw.locationArchived === true;
    return {
      locationArchived,
      closed: raw.closed === true,
      // A legacy baseline predates the stamp: an already-archived project
      // carries '' (unknown transition time), an active one null.
      archivedAt:
        typeof raw.archivedAt === 'string'
          ? raw.archivedAt
          : locationArchived
            ? ''
            : null,
    };
  }

  async getWatchState(projectName: string): Promise<WatchStateData> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      const raw = node === null ? undefined : node.watch;
      return isRecord(raw)
        ? this.mapWatchState(raw)
        : { etag: null, cursor: null };
    });
  }

  async setWatchState(
    projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      ensureProjectNode(ensureProjects(container), projectName).watch = state;
      await this.persist();
    });
  }

  private mapWatchState(raw: Record<string, unknown>): WatchStateData {
    return {
      etag: typeof raw.etag === 'string' ? raw.etag : null,
      cursor: typeof raw.cursor === 'string' ? raw.cursor : null,
    };
  }

  // Reads the project's one-shot marker without clearing it. The chain peeks
  // before the code host half and only consumes after that half succeeds, so a
  // failed or interrupted fetch never spends the scan.
  async isFullScanPending(projectName: string): Promise<boolean> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      return node !== null && node[FULL_SCAN_PENDING_KEY] === true;
    });
  }

  // Clears the project's one-shot marker. Only a pending marker is persisted
  // (write-then-clear): consuming an already-spent project is a pure read.
  async consumeFullScan(projectName: string): Promise<boolean> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      const node = projectNode(readProjectsMap(container), projectName);
      const pending = node !== null && node[FULL_SCAN_PENDING_KEY] === true;
      if (pending) {
        node[FULL_SCAN_PENDING_KEY] = false;
        await this.persist();
      }
      return pending;
    });
  }

  async getProjectCursor(portId: string): Promise<string | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const cursors = container[PROJECT_CURSORS_KEY];
      if (!isRecord(cursors)) {
        return null;
      }
      const raw = cursors[portId];
      return typeof raw === 'string' ? raw : null;
    });
  }

  async setProjectCursor(portId: string, iso: string): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      if (!isRecord(container[PROJECT_CURSORS_KEY])) {
        container[PROJECT_CURSORS_KEY] = {};
      }
      const cursors = container[PROJECT_CURSORS_KEY] as Record<string, unknown>;
      // A cursor that does not move is not a write. WHY: the capture runs on
      // every tick, and persisting an unchanged watermark would make a quiet
      // tick dirty the registry (SYNC-8). The caller also guards, but the
      // adapter is the single writer and owns the invariant.
      if (cursors[portId] === iso) {
        return;
      }
      cursors[portId] = iso;
      await this.persist();
    });
  }

  private mapIdentity(raw: Record<string, unknown>): ProjectIdentityData {
    return new ProjectIdentityData({
      repoUrl: typeof raw.repoUrl === 'string' ? raw.repoUrl : '',
      repoNodeId: typeof raw.repoNodeId === 'string' ? raw.repoNodeId : '',
      projectNodeId:
        typeof raw.projectNodeId === 'string' ? raw.projectNodeId : '',
      statusFieldId:
        typeof raw.statusFieldId === 'string' ? raw.statusFieldId : '',
      statusOptions: Array.isArray(raw.statusOptions)
        ? raw.statusOptions
            .filter(isRecord)
            .filter(
              (o): o is { id: string; name: string } =>
                typeof o.id === 'string' && typeof o.name === 'string',
            )
            .map((o) => ({ id: o.id, name: o.name }))
        : [],
    });
  }
}
