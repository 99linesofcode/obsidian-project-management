import { isRecord } from '../../core/domain/isRecord.js';
import { stringOrEmpty } from '../../core/domain/strings.js';
import {
  TOMBSTONES_KEY,
  ensureItemsMap,
  ensurePortNode,
  ensureProjectNode,
  ensureProjects,
  entityMap,
  itemsMap,
  mapTombstone,
  portNode,
  portsMap,
  projectNode,
  readProjectsMap,
  tombstonesList,
} from './syncStateSchema.js';

export interface ItemRef {
  project: string;
  portId: string;
  handle: string;
  entityId: string;
}

export interface HandleOwner {
  project: string;
  entityId: string;
}

export interface Indexes {
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

export function buildIndexes(container: Record<string, unknown>): Indexes {
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
      const notePath = stringOrEmpty(raw.notePath);
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
        const entityId = stringOrEmpty(rawItem.entityId);
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

export function dropItem(
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

export function dropEntity(
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

  const tombstones = tombstonesList(container);
  if (tombstones.length > 0) {
    container[TOMBSTONES_KEY] = tombstones.filter((raw) => {
      const tombstone = mapTombstone(raw);
      return tombstone === null || tombstone.entityId !== id;
    });
  }
}

export function removeItemNode(
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

export function removeItemRef(
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

export function addItemRef(
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

export function relocateItems(
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
