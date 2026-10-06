import { isRecord } from '../shared/isRecord.js';
import { TaskData } from '../shared/TaskData.js';
import type { MirrorItem, PortState } from '../shared/SyncStatePort.js';

// The container schema: the persisted shape's constants and the pure readers
// and writers of its nested nodes. Migrations and the adapter share these so
// the schema has exactly one definition.

// The sync state lives under its own top-level key, so the plugin's settings
// (which merge the data.json root) never absorb a `status.*`/`todoistItem.*`
// key. Before t5 the records were flat at the root; `migrateLegacyState` moves
// them under this key once, on load.
export const SYNC_STATE_KEY = 'syncState';

// The registry version marker. The layout below is v3; a container without it
// is migrated once and marked.
export const VERSION = 3;

export const ENTITIES_KEY = 'entities';
export const PROJECTS_KEY = 'projects';
export const PORTS_KEY = 'ports';
export const ITEMS_KEY = 'items';

// The project-capture cursors, keyed by remote SURFACE (portId). WHY a
// container-level map and not a per-project node: the cursor guards a global
// listing (all task-manager projects, all the viewer's boards), which has no
// project to nest under. It is a new top-level dimension beside `projects`.
export const PROJECT_CURSORS_KEY = 'projectCursors';

// The one-shot marker that forces the first parent-aware fetch after a store
// predates parent tracking. It lives on the PROJECT node (projects.<name>.
// fullScanPending): a single container-level flag was consumed by whichever
// project synced first, leaving every other project blind. Absent = pending.
export const FULL_SCAN_PENDING_KEY = 'fullScanPending';

export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function stringOrNull(value: unknown): string | null {
  return value === null || typeof value === 'string' ? value : null;
}

// The projects map of a container, created on demand.
export function readProjectsMap(container: Record<string, unknown>): Record<string, unknown> {
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

export function entityMap(node: Record<string, unknown>): Record<string, unknown> {
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

export function portsMap(node: Record<string, unknown>): Record<string, unknown> {
  return isRecord(node[PORTS_KEY]) ? node[PORTS_KEY] : {};
}

export function portNode(
  node: Record<string, unknown>,
  portId: string,
): Record<string, unknown> | null {
  const raw = portsMap(node)[portId];
  return isRecord(raw) ? raw : null;
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

export function itemsMap(port: Record<string, unknown>): Record<string, unknown> {
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

// A stored port item, as the core's MirrorItem. A malformed entry yields null
// rather than a half-read item.
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
