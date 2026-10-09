import { isRecord } from '../core/isRecord.js';
import { TaskData } from '../core/TaskData.js';
import type { MirrorItem } from '../core/data/MirrorItem.js';
import type { PortState } from '../core/data/PortState.js';

export const SYNC_STATE_KEY = 'syncState';

export const VERSION = 3;

export const ENTITIES_KEY = 'entities';
export const PROJECTS_KEY = 'projects';
export const PORTS_KEY = 'ports';
export const ITEMS_KEY = 'items';
export const IDENTITIES_KEY = 'identities';

export const PROJECT_CURSORS_KEY = 'projectCursors';

export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function stringOrNull(value: unknown): string | null {
  return value === null || typeof value === 'string' ? value : null;
}

export function readProjectsMap(
  container: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(container[PROJECTS_KEY]) ? container[PROJECTS_KEY] : {};
}

export function ensureProjects(
  container: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(container[PROJECTS_KEY])) {
    container[PROJECTS_KEY] = {};
  }
  return container[PROJECTS_KEY] as Record<string, unknown>;
}

export function projectNode(
  projects: Record<string, unknown>,
  name: string,
): Record<string, unknown> | null {
  const raw = projects[name];
  return isRecord(raw) ? raw : null;
}

export function ensureProjectNode(
  projects: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  if (!isRecord(projects[name])) {
    projects[name] = {};
  }
  return projects[name] as Record<string, unknown>;
}

export function entityMap(
  node: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(node[ENTITIES_KEY]) ? node[ENTITIES_KEY] : {};
}

export function ensureEntityMap(
  node: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(node[ENTITIES_KEY])) {
    node[ENTITIES_KEY] = {};
  }
  return node[ENTITIES_KEY] as Record<string, unknown>;
}

export function portsMap(
  node: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(node[PORTS_KEY]) ? node[PORTS_KEY] : {};
}

export function portNode(
  node: Record<string, unknown>,
  portId: string,
): Record<string, unknown> | null {
  const raw = portsMap(node)[portId];
  return isRecord(raw) ? raw : null;
}

export function identitiesMap(
  node: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(node[IDENTITIES_KEY]) ? node[IDENTITIES_KEY] : {};
}

export function ensureIdentitiesMap(
  node: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(node[IDENTITIES_KEY])) {
    node[IDENTITIES_KEY] = {};
  }
  return node[IDENTITIES_KEY] as Record<string, unknown>;
}

export function ensurePortNode(
  node: Record<string, unknown>,
  portId: string,
): Record<string, unknown> {
  const ports = portsMap(node);
  if (!isRecord(node[PORTS_KEY])) {
    node[PORTS_KEY] = ports;
  }
  if (!isRecord(ports[portId])) {
    ports[portId] = {};
  }
  return ports[portId] as Record<string, unknown>;
}

export function itemsMap(
  port: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(port[ITEMS_KEY]) ? port[ITEMS_KEY] : {};
}

export function ensureItemsMap(
  port: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(port[ITEMS_KEY])) {
    port[ITEMS_KEY] = {};
  }
  return port[ITEMS_KEY] as Record<string, unknown>;
}

export function mapBase(raw: unknown): TaskData | null {
  if (!isRecord(raw)) {
    return null;
  }
  return new TaskData({
    id: str(raw.id),
    notePath: str(raw.notePath),
    mirrors: {},
    title: str(raw.title),
    body: str(raw.body),
    status: str(raw.status),
    completedAt: stringOrNull(raw.completedAt),
    type: str(raw.type),
    parent: stringOrNull(raw.parent),
    createdAt: stringOrNull(raw.createdAt),
    updatedAt: stringOrNull(raw.updatedAt),
  });
}

export function mapMirrorItem(raw: unknown): MirrorItem | null {
  if (!isRecord(raw)) {
    return null;
  }
  return { entityId: str(raw.entityId), base: mapBase(raw.base) };
}

export function mapPortState(
  raw: Record<string, unknown>,
  portId: string,
): PortState {
  return {
    provider: typeof raw.provider === 'string' ? raw.provider : portId,
    project: typeof raw.project === 'string' ? raw.project : '',
    lastPoll: stringOrNull(raw.lastPoll),
    lanes: stringMap(raw.lanes),
  };
}

export function stringMap(raw: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }
  }
  return result;
}
