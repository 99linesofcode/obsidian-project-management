import { isRecord } from '../../domain/isRecord.js';
import { projectFromNotePath } from '../../domain/projectFromNotePath.js';
import { ProjectIdentityData } from '../../domain/data/ProjectIdentityData.js';
import type { EntityRecord } from '../../domain/data/EntityRecord.js';
import type { MirrorItem } from '../../domain/data/MirrorItem.js';
import type { PortState } from '../../domain/data/PortState.js';
import type { ConnectionStatePort } from '../../domain/ports/ConnectionStatePort.js';
import type { IdentityStorePort } from '../../domain/ports/IdentityStorePort.js';
import type { TrackedEntityPort } from '../../domain/ports/TrackedEntityPort.js';
import {
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
} from './syncStateSchema.js';

export interface SyncStateStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
  backup?(): Promise<void>;
}

const BACKUP_MIN_INTERVAL_MS = 60_000;

export { SYNC_STATE_KEY } from './syncStateSchema.js';

interface ItemRef {
  project: string;
  portId: string;
  handle: string;
  entityId: string;
}

interface HandleOwner {
  project: string;
  entityId: string;
}

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

export class SyncStateAdapter
  implements IdentityStorePort, TrackedEntityPort, ConnectionStatePort
{
  private indexes: Indexes | null = null;
  private container: Record<string, unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastBackupAt: number | null = null;
  private readOnly = false;

  constructor(private readonly storage: SyncStateStorage) {}

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

  private assertWritable(): void {
    if (this.readOnly) {
      throw new Error(
        'registry written by a newer plugin version — refusing to mutate',
      );
    }
  }

  mutateRoot(
    fn: (
      root: Record<string, unknown>,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): Promise<void> {
    return this.queue(async () => {
      await this.loadContainer();
      const data = await this.storage.load();
      const next = await fn(data);
      await this.storage.save(next);
    });
  }

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
      const project = projectFromNotePath(record.notePath);
      const previousProject = indexes.byEntityProject.get(record.id);
      const previousPath = indexes.byEntityPath.get(record.id);

      const occupant = indexes.byNotePath.get(record.notePath);
      if (occupant !== undefined && occupant !== record.id) {
        dropEntity(container, indexes, occupant);
      }

      if (
        previousPath !== undefined &&
        previousPath !== record.notePath &&
        indexes.byNotePath.get(previousPath) === record.id
      ) {
        indexes.byNotePath.delete(previousPath);
      }
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

      const owner = indexes.byHandle.get(portId)?.get(handle);
      if (owner !== undefined) {
        if (owner.project !== projectName) {
          removeItemNode(container, owner.project, portId, handle);
          removeItemRef(indexes, owner.entityId, portId, handle);
        } else if (owner.entityId !== item.entityId) {
          removeItemRef(indexes, owner.entityId, portId, handle);
        }
      }

      const node = ensureProjectNode(ensureProjects(container), projectName);
      const port = ensurePortNode(node, portId);
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
