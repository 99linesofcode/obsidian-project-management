import { Baseline } from '../../core/domain/Baseline.js';
import { isRecord } from '../../core/domain/isRecord.js';
import type { MergedField } from '../../core/domain/canonicalField.js';
import {
  projectFromNotePath,
  projectPathWithName,
} from '../../core/domain/paths.js';
import { stringOrEmpty, stringOrNull } from '../../core/domain/strings.js';
import { ProjectIdentityDataTransferObject } from '../../core/port/data/ProjectIdentityDataTransferObject.js';
import type { EntityRecord } from '../../core/port/data/EntityRecord.js';
import type { MirrorItem } from '../../core/port/data/MirrorItem.js';
import type { PortState } from '../../core/port/data/PortState.js';
import type { TombstoneRecord } from '../../core/port/data/TombstoneRecord.js';
import type { RegistryPort } from '../../core/port/RegistryPort.js';
import { ensureRecord, readPath } from './coreStorageRecord.js';
import {
  addItemRef,
  buildIndexes,
  dropEntity,
  dropItem,
  relocateItems,
  removeItemNode,
  removeItemRef,
  type Indexes,
} from './syncStateIndex.js';
import {
  SYNC_STATE_KEY,
  VERSION,
  ensureEntityMap,
  ensureIdentitiesMap,
  ensureItemsMap,
  ensurePortNode,
  ensureProjectNode,
  ensureProjects,
  ensureTombstonesList,
  entityMap,
  identitiesMap,
  itemsMap,
  mapMirrorItem,
  mapPortState,
  mapTombstone,
  portNode,
  portsMap,
  projectNode,
  readProjectsMap,
  tombstonesList,
} from './syncStateSchema.js';

export interface SyncStateStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
  backup?(): Promise<void>;
}

const BACKUP_MIN_INTERVAL_MS = 60_000;

const CORE_BASELINES_KEY = 'coreBaselines';

export { SYNC_STATE_KEY } from './syncStateSchema.js';

export class SyncStateAdapter implements RegistryPort {
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
    } catch {}
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
    return isRecord(raw) ? { id, notePath: stringOrEmpty(raw.notePath) } : null;
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
          notePath: stringOrEmpty((raw as Record<string, unknown>).notePath),
        }));
    });
  }

  async rekeyProject(fromProject: string, toProject: string): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      if (fromProject === toProject) {
        return;
      }
      const projects = readProjectsMap(container);
      const fromNode = projectNode(projects, fromProject);
      if (fromNode === null) {
        return;
      }
      const toNode = ensureProjectNode(ensureProjects(container), toProject);
      mergeProjectNode(toNode, fromNode);
      rekeyEntityPaths(toNode, toProject);
      delete projects[fromProject];
      this.indexes = buildIndexes(container);
      await this.maybeBackup();
      const data = await this.storage.load();
      moveProjectBaseline(data, fromProject, toProject);
      data[SYNC_STATE_KEY] = this.container;
      await this.storage.save(data);
    });
  }

  async hasProject(projectName: string): Promise<boolean> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      return projectNode(readProjectsMap(container), projectName) !== null;
    });
  }

  async listProjects(): Promise<string[]> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      return Object.keys(readProjectsMap(container)).sort();
    });
  }

  async recordTombstone(record: TombstoneRecord): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      const tombstones = ensureTombstonesList(container);
      const stored =
        record.handle === undefined || record.handle === ''
          ? {
              entityId: record.entityId,
              notePath: record.notePath,
              deletedAt: record.deletedAt,
            }
          : {
              entityId: record.entityId,
              notePath: record.notePath,
              deletedAt: record.deletedAt,
              handle: record.handle,
            };
      const index = tombstones.findIndex((raw) => {
        const existing = mapTombstone(raw);
        return (
          existing !== null &&
          existing.notePath === record.notePath &&
          existing.handle === record.handle
        );
      });
      if (index === -1) {
        tombstones.push(stored);
      } else {
        tombstones[index] = stored;
      }
      await this.persist();
    });
  }

  async removeTombstone(notePath: string): Promise<void> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      this.assertWritable();
      const tombstones = ensureTombstonesList(container);
      let removed = false;
      for (let i = tombstones.length - 1; i >= 0; i--) {
        const tombstone = mapTombstone(tombstones[i]!);
        if (tombstone !== null && tombstone.notePath === notePath) {
          tombstones.splice(i, 1);
          removed = true;
        }
      }
      if (removed) {
        await this.persist();
      }
    });
  }

  async findTombstoneByNotePath(
    notePath: string,
  ): Promise<TombstoneRecord | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      let found: TombstoneRecord | null = null;
      for (const raw of tombstonesList(container)) {
        const tombstone = mapTombstone(raw);
        if (tombstone !== null && tombstone.notePath === notePath) {
          found = tombstone;
        }
      }
      return found;
    });
  }

  async findTombstone(handle: string): Promise<TombstoneRecord | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      for (const raw of tombstonesList(container)) {
        const tombstone = mapTombstone(raw);
        if (tombstone !== null && tombstone.handle === handle) {
          return tombstone;
        }
      }
      return null;
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
          const entityId = stringOrEmpty(raw.entityId);
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

  async resolveMirrorHandle(
    connection: string,
    notePath: string,
  ): Promise<string | null> {
    const entity = await this.findByNotePath(notePath);
    if (entity === null) {
      return null;
    }
    const item = await this.findMirrorItemByEntity(connection, entity.id);
    return item?.handle ?? null;
  }

  async listMirrorHandles(
    project: string,
    connection: string,
  ): Promise<readonly { handle: string; notePath: string }[]> {
    const items = await this.listMirrorItems(project, connection);
    const resolved: Array<{ handle: string; notePath: string }> = [];
    for (const { handle, item } of items) {
      const entity = await this.getEntity(item.entityId);
      if (entity !== null) {
        resolved.push({ handle, notePath: entity.notePath });
      }
    }
    return resolved;
  }

  async recordMirrorHandle(
    project: string,
    connection: string,
    notePath: string,
    handle: string,
  ): Promise<void> {
    const entity = await this.findByNotePath(notePath);
    const entityId = entity?.id ?? crypto.randomUUID();
    if (entity === null) {
      await this.setEntity({ id: entityId, notePath });
    }
    const existing = await this.findMirrorItemByEntity(connection, entityId);
    if (existing !== null && existing.handle !== handle) {
      await this.removeMirrorItem(project, connection, existing.handle);
    }
    await this.setMirrorItem(project, connection, handle, { entityId });
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

  async resolveMirrorProject(
    project: string,
    connection: string,
  ): Promise<string | null> {
    const state = await this.getPortState(project, connection);
    return state === null || state.project === '' ? null : state.project;
  }

  async recordMirrorProject(
    project: string,
    connection: string,
    application: string,
    handle: string,
  ): Promise<void> {
    const state = await this.getPortState(project, connection);
    await this.setPortState(project, connection, {
      provider: state?.provider ?? application,
      project: handle,
      lastPoll: state?.lastPoll ?? null,
      lanes: state?.lanes ?? {},
    });
  }

  async setIdentity(
    projectName: string,
    connectionSlug: string,
    identity: ProjectIdentityDataTransferObject,
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
  ): Promise<ProjectIdentityDataTransferObject | null> {
    return this.queue(async () => {
      const container = await this.loadContainer();
      const node = projectNode(readProjectsMap(container), projectName);
      const raw =
        node === null ? undefined : identitiesMap(node)[connectionSlug];
      return isRecord(raw) ? this.mapIdentity(raw) : null;
    });
  }

  async readBaseline(
    entityId: string,
    field: MergedField,
    side: string,
  ): Promise<Baseline | null> {
    const data = await this.storage.load();
    const entry = readBaselineEntry(data, entityId, field, side);
    if (!isRecord(entry)) {
      return null;
    }
    return new Baseline(stringOrNull(entry.value), entry.completed === true);
  }

  async writeBaseline(
    entityId: string,
    field: MergedField,
    side: string,
    baseline: Baseline,
  ): Promise<void> {
    const data = await this.storage.load();
    const baselines = ensureRecord(data, CORE_BASELINES_KEY);
    const entity = ensureRecord(baselines, entityId);
    const fieldNode = ensureRecord(entity, field);
    fieldNode[side] = { value: baseline.value, completed: baseline.completed };
    await this.storage.save(data);
  }

  private mapIdentity(
    raw: Record<string, unknown>,
  ): ProjectIdentityDataTransferObject {
    const text = (...candidates: unknown[]): string =>
      candidates.find((value): value is string => typeof value === 'string') ??
      '';

    return new ProjectIdentityDataTransferObject({
      target: text(raw.target, raw.target),
      targetHandle: text(raw.targetHandle, raw.repoNodeId),
      projectHandle: text(raw.projectHandle, raw.projectNodeId),
      statusFieldHandle: text(raw.statusFieldHandle, raw.statusFieldId),
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

function mergeProjectNode(
  toNode: Record<string, unknown>,
  fromNode: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(fromNode)) {
    if (isRecord(value)) {
      const target = isRecord(toNode[key])
        ? (toNode[key] as Record<string, unknown>)
        : {};
      Object.assign(target, value);
      toNode[key] = target;
    } else {
      toNode[key] = value;
    }
  }
}

function rekeyEntityPaths(
  node: Record<string, unknown>,
  toProject: string,
): void {
  for (const raw of Object.values(entityMap(node))) {
    if (isRecord(raw) && typeof raw.notePath === 'string') {
      raw.notePath = projectPathWithName(raw.notePath, toProject);
    }
  }
}

function moveProjectBaseline(
  data: Record<string, unknown>,
  fromProject: string,
  toProject: string,
): void {
  const baselines = data[CORE_BASELINES_KEY];
  if (!isRecord(baselines) || !isRecord(baselines[fromProject])) {
    return;
  }
  baselines[toProject] = baselines[fromProject];
  delete baselines[fromProject];
}

function readBaselineEntry(
  data: Record<string, unknown>,
  entityId: string,
  field: MergedField,
  side: string,
): unknown {
  const entry = readPath(data, [CORE_BASELINES_KEY, entityId, field, side]);
  if (entry !== undefined || field !== 'archived') {
    return entry;
  }
  return readPath(data, [CORE_BASELINES_KEY, entityId, 'lifecycle', side]);
}
