import type { ArchiveBaselineData } from '../../Domain/DataTransferObjects/ArchiveBaselineData.js';
import { Mirror } from '../../Domain/DataTransferObjects/Mirror.js';
import type { ProjectIdentityData } from '../../Domain/DataTransferObjects/ProjectIdentityData.js';
import { TaskData } from '../../Domain/DataTransferObjects/TaskData.js';
import type { WatchStateData } from '../../Domain/DataTransferObjects/WatchStateData.js';
import type {
  EntityRecord,
  MirrorItem,
  PortState,
  SyncStatePort,
} from '../../Domain/Ports/SyncStatePort.js';
import { projectFromNotePath } from '../../Domain/Notes/projectFromNotePath.js';
import { toDiffViewWithBody } from '../../Domain/Reconciliation/toDiffView.js';

// The storage the adapter persists through. main.ts binds the plugin's
// loadData/saveData so records live in the plugin's data.json.
export interface SyncStateStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
}

// The sync state lives under its own top-level key, so the plugin's settings
// (which merge the data.json root) never absorb a `status.*`/`todoistItem.*`
// key. Before t5 the records were flat at the root; `migrateLegacyState` moves
// them under this key once, on load.
export const SYNC_STATE_KEY = 'syncState';

// The registry version marker. The layout below is v3; a container without it
// is migrated once and marked.
const VERSION = 3;

const ENTITIES_KEY = 'entities';
const PROJECTS_KEY = 'projects';
const PORTS_KEY = 'ports';
const ITEMS_KEY = 'items';

const STATUS_PREFIX = 'status.';
const TODOIST_ITEM_PREFIX = 'todoistItem.';

// The flat project-level namespaces of the pre-v3 layout. Each folds into its
// `projects.<name>` home; the two per-entity prefixes are handled by
// `migrateEntities` before the v3 fold.
const LEGACY_PROJECT_PREFIXES: ReadonlyArray<[string, string]> = [
  ['identity.', 'identity'],
  ['projectUpdate.', 'lastProjectUpdate'],
  ['archiveBaseline.', 'archive'],
  ['watch.', 'watch'],
];

// A legacy record is any root key carrying one of these prefixes; after
// migration every record lives inside the container.
const LEGACY_PREFIXES = [
  'status.',
  'identity.',
  'projectUpdate.',
  'archiveBaseline.',
  'watch.',
  'todoistProject.',
  'todoistItem.',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringOrNull(value: unknown): string | null {
  return value === null || typeof value === 'string' ? value : null;
}

// Moves any legacy flat sync-state key under the `syncState` container. Returns
// whether it changed the data. The legacy records keep their value; the
// canonical mapping is lazy, so an old provider-shaped record still loads (and
// is rewritten canonically on its next write). Existing user data survives: no
// record is dropped, only relocated.
export function migrateLegacyState(data: Record<string, unknown>): boolean {
  if (isRecord(data[SYNC_STATE_KEY])) {
    return false;
  }

  const root: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      root[key] = data[key];
      delete data[key];
    }
  }
  data[SYNC_STATE_KEY] = root;
  return true;
}

// One-shot migration of the two legacy per-entity stores into the uuid-keyed
// registry (the v2 shape, still with a per-entity mirrors map). A `status.<url>`
// record becomes an entity with a `github` mirror; a `todoistItem.<notePath>`
// record merges into the entity at that path, or creates a Todoist-only entity
// when none exists (a vault to-do has no GitHub issue and legitimately has no
// GitHub record). The legacy keys are deleted afterwards, so a second load is a
// no-op. Never drops data: a record that cannot be parsed is left in place
// rather than discarded.
export function migrateEntities(container: Record<string, unknown>): boolean {
  const statusKeys = Object.keys(container).filter((key) =>
    key.startsWith(STATUS_PREFIX),
  );
  const todoKeys = Object.keys(container).filter((key) =>
    key.startsWith(TODOIST_ITEM_PREFIX),
  );
  if (statusKeys.length === 0 && todoKeys.length === 0) {
    return false;
  }

  const entities: Record<string, unknown> = isRecord(container[ENTITIES_KEY])
    ? container[ENTITIES_KEY]
    : {};
  // The path index lets the Todoist half merge into the GitHub entity that
  // already owns the note. Seeded from any entities present so a resumed
  // migration still joins the two halves.
  const idByNotePath = new Map<string, string>();
  for (const [id, raw] of Object.entries(entities)) {
    if (isRecord(raw)) {
      idByNotePath.set(str(raw.notePath), id);
    }
  }

  let migrated = false;

  for (const key of statusKeys) {
    const raw = container[key];
    if (!isRecord(raw)) {
      continue;
    }
    const fields = parseLegacyStatusRecord(raw);
    const id = crypto.randomUUID();
    entities[id] = {
      id,
      notePath: fields.notePath,
      mirrors: {
        github: new Mirror(
          key.slice(STATUS_PREFIX.length),
          githubBase(id, fields),
        ),
      },
    };
    idByNotePath.set(fields.notePath, id);
    delete container[key];
    migrated = true;
  }

  for (const key of todoKeys) {
    const raw = container[key];
    if (!isRecord(raw)) {
      continue;
    }
    const notePath = key.slice(TODOIST_ITEM_PREFIX.length);
    const fields = parseLegacyTodoRecord(raw);
    const id = idByNotePath.get(notePath) ?? crypto.randomUUID();
    const record = isRecord(entities[id])
      ? (entities[id] as {
          id: string;
          notePath: string;
          mirrors: Record<string, Mirror>;
        })
      : { id, notePath, mirrors: {} as Record<string, Mirror> };
    record.mirrors.todoist = new Mirror(
      fields.todoistId,
      todoistBase(id, notePath, fields),
    );
    entities[id] = record;
    idByNotePath.set(notePath, id);
    delete container[key];
    migrated = true;
  }

  if (migrated) {
    container[ENTITIES_KEY] = entities;
  }
  return migrated;
}

// One-shot migration of the v2 layout (a flat `entities.<uuid>` map with a
// per-entity `mirrors` map, beside flat `identity.*`/`projectUpdate.*`/... and
// `todoistProject.*` namespaces) into the v3 project-nested, port-grouped
// layout. Each v2 entity derives its project from its notePath and becomes
// `projects.<name>.entities.<uuid> = { notePath }`; each mirror entry becomes
// `projects.<name>.ports.<portId>.items.<handle> = { entityId, base }`. The
// flat namespaces fold into `projects.<name>.*`; a `todoistProject.<name>`
// record becomes that project's `ports.todoist` state. Version-marked and
// idempotent: a container already marked v3 loads as-is. Never drops data — an
// entity whose path names no project lands in the unnamed ('') bucket rather
// than being discarded.
export function migrateV3(container: Record<string, unknown>): boolean {
  if (container.version === VERSION) {
    return false;
  }

  const projects: Record<string, unknown> = isRecord(container[PROJECTS_KEY])
    ? container[PROJECTS_KEY]
    : {};

  // v2 entities -> project-nested entities plus port items.
  const entities = isRecord(container[ENTITIES_KEY])
    ? container[ENTITIES_KEY]
    : {};
  for (const [id, raw] of Object.entries(entities)) {
    if (!isRecord(raw)) {
      continue;
    }
    const notePath = str(raw.notePath);
    const node = ensureProjectNode(projects, projectFromNotePath(notePath));
    ensureEntityMap(node)[id] = { notePath };
    if (isRecord(raw.mirrors)) {
      for (const [portId, mirror] of Object.entries(raw.mirrors)) {
        if (!isRecord(mirror)) {
          continue;
        }
        const handle = str(mirror.handle);
        const port = ensurePortNode(node, portId);
        ensureItemsMap(port)[handle] = {
          entityId: id,
          base: mirror.base ?? null,
        };
      }
    }
  }
  if (isRecord(container[ENTITIES_KEY])) {
    delete container[ENTITIES_KEY];
  }

  // Flat project namespaces -> projects.<name>.<field>.
  for (const [prefix, field] of LEGACY_PROJECT_PREFIXES) {
    for (const key of Object.keys(container)) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const name = key.slice(prefix.length);
      ensureProjectNode(projects, name)[field] = container[key];
      delete container[key];
    }
  }

  // todoistProject.<name> -> projects.<name>.ports.todoist state.
  for (const key of Object.keys(container)) {
    if (!key.startsWith('todoistProject.')) {
      continue;
    }
    const name = key.slice('todoistProject.'.length);
    const raw = container[key];
    const node = ensureProjectNode(projects, name);
    const port = ensurePortNode(node, 'todoist');
    // WHY provider = 'todoist': the port id is the generic identifier; the
    // concrete service is a VALUE in the dedicated provider field.
    port.provider = 'todoist';
    port.lastPoll = isRecord(raw)
      ? (typeof raw.lastCompletedPoll === 'string'
          ? raw.lastCompletedPoll
          : null)
      : null;
    port.lanes = isRecord(raw) && isRecord(raw.sections) ? raw.sections : {};
    delete container[key];
  }

  container.version = VERSION;
  container[PROJECTS_KEY] = projects;
  // Always changed: the version marker itself is a write on first load.
  return true;
}

// The fields a legacy per-entity record carried, normalized so both the
// canonical and the pre-t5 provider-shaped records migrate the same way.
interface LegacyFields {
  notePath: string;
  title: string;
  body: string;
  status: string;
  completed: boolean;
  parent: string | null;
  todoistId: string;
  updatedAt: string;
}

// A `status.<url>` record: a canonical record carries the content fields, a
// pre-t5 provider-shaped `Status` record carries the lastSynced* names. The
// lane is preserved verbatim — the old adapter collapsed it to 'done'|'open'.
function parseLegacyStatusRecord(raw: Record<string, unknown>): LegacyFields {
  if (typeof raw.title === 'string' && typeof raw.status === 'string') {
    return {
      notePath: str(raw.notePath),
      title: raw.title,
      body: str(raw.body),
      status: raw.status,
      completed: raw.completed === true,
      parent: null,
      todoistId: '',
      updatedAt: str(raw.updatedAt),
    };
  }
  return {
    notePath: str(raw.notePath),
    title: str(raw.lastSyncedTitle),
    body: str(raw.lastSyncedBodyHash),
    status: str(raw.lastSyncedStatus),
    completed: raw.lastSyncedStatus === 'done',
    parent: null,
    todoistId: '',
    updatedAt: str(raw.lastSyncedRemoteUpdatedAt),
  };
}

// A `todoistItem.<notePath>` record, canonical or pre-t5 `TodoistStateData`.
// A to-do has no body text and no vault lane; its parent is a mirror id here,
// remapped to the parent's uuid by a later ticket.
function parseLegacyTodoRecord(raw: Record<string, unknown>): LegacyFields {
  if (typeof raw.title === 'string' && typeof raw.status === 'string') {
    return {
      notePath: str(raw.notePath),
      title: raw.title,
      body: str(raw.body),
      status: raw.status,
      completed: raw.completed === true,
      parent: stringOrNull(raw.parent),
      todoistId: str(raw.todoistId),
      updatedAt: str(raw.updatedAt),
    };
  }
  return {
    notePath: str(raw.notePath),
    title: str(raw.lastSyncedContent),
    body: '',
    status: raw.lastSyncedLane === null ? '' : str(raw.lastSyncedLane),
    completed: raw.lastSyncedCompleted === true,
    parent: stringOrNull(raw.lastSyncedParent),
    todoistId: str(raw.todoistId),
    updatedAt: '',
  };
}

// The old store kept a completion bit, not a stamp. '' marks "done, stamp
// unknown": it preserves the invariant completedAt !== null iff the task is
// done, while signalling the migration could not recover the real timestamp.
function migratedCompletedAt(completed: boolean): string | null {
  return completed ? '' : null;
}

// The GitHub base is a diff view whose body already held the issue-body digest,
// so it is stored as-is — re-hashing would change the fingerprint and make
// every migrated task look locally edited.
function githubBase(id: string, fields: LegacyFields): TaskData {
  return new TaskData(
    id,
    fields.notePath,
    {}, // bases carry no handles
    fields.title,
    fields.body,
    fields.status,
    migratedCompletedAt(fields.completed),
    '', // the vault-owned type was never mirrored
    null, // parent is a uuid reference; the old record had none
    null, // created provenance unknown
    fields.updatedAt || null,
  );
}

// A to-do base has no body text in the old store; hashing it makes the base a
// proper diff view (a base's body field always carries a digest). Its parent is
// carried across.
function todoistBase(
  id: string,
  notePath: string,
  fields: LegacyFields,
): TaskData {
  return toDiffViewWithBody(
    new TaskData(
      id,
      notePath,
      {},
      fields.title,
      fields.body,
      fields.status,
      migratedCompletedAt(fields.completed),
      '',
      fields.parent,
      null,
      fields.updatedAt || null,
    ),
  );
}

// The projects map of a container, created on demand.
function projectsMap(container: Record<string, unknown>): Record<string, unknown> {
  return isRecord(container[PROJECTS_KEY]) ? container[PROJECTS_KEY] : {};
}

function ensureProjects(
  container: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(container[PROJECTS_KEY])) {
    container[PROJECTS_KEY] = {};
  }
  return container[PROJECTS_KEY] as Record<string, unknown>;
}

function projectNode(
  projects: Record<string, unknown>,
  name: string,
): Record<string, unknown> | null {
  const raw = projects[name];
  return isRecord(raw) ? raw : null;
}

function ensureProjectNode(
  projects: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  if (!isRecord(projects[name])) {
    projects[name] = {};
  }
  return projects[name] as Record<string, unknown>;
}

function entityMap(node: Record<string, unknown>): Record<string, unknown> {
  return isRecord(node[ENTITIES_KEY]) ? node[ENTITIES_KEY] : {};
}

function ensureEntityMap(
  node: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(node[ENTITIES_KEY])) {
    node[ENTITIES_KEY] = {};
  }
  return node[ENTITIES_KEY] as Record<string, unknown>;
}

function portsMap(node: Record<string, unknown>): Record<string, unknown> {
  return isRecord(node[PORTS_KEY]) ? node[PORTS_KEY] : {};
}

function portNode(
  node: Record<string, unknown>,
  portId: string,
): Record<string, unknown> | null {
  const raw = portsMap(node)[portId];
  return isRecord(raw) ? raw : null;
}

function ensurePortNode(
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

function itemsMap(port: Record<string, unknown>): Record<string, unknown> {
  return isRecord(port[ITEMS_KEY]) ? port[ITEMS_KEY] : {};
}

function ensureItemsMap(
  port: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(port[ITEMS_KEY])) {
    port[ITEMS_KEY] = {};
  }
  return port[ITEMS_KEY] as Record<string, unknown>;
}

function mapBase(raw: unknown): TaskData | null {
  if (!isRecord(raw)) {
    return null;
  }
  return new TaskData(
    str(raw.id),
    str(raw.notePath),
    {}, // bases carry no handles
    str(raw.title),
    str(raw.body),
    str(raw.status),
    stringOrNull(raw.completedAt),
    str(raw.type),
    stringOrNull(raw.parent),
    stringOrNull(raw.createdAt),
    stringOrNull(raw.updatedAt),
  );
}

// A stored port item, as the core's MirrorItem. A malformed entry yields null
// rather than a half-read item.
function mapMirrorItem(raw: unknown): MirrorItem | null {
  if (!isRecord(raw)) {
    return null;
  }
  return { entityId: str(raw.entityId), base: mapBase(raw.base) };
}

function mapPortState(
  raw: Record<string, unknown>,
  portId: string,
): PortState {
  return {
    provider: typeof raw.provider === 'string' ? raw.provider : portId,
    lastPoll: stringOrNull(raw.lastPoll),
    lanes: stringMap(raw.lanes),
    tags: stringMap(raw.tags),
  };
}

function stringMap(raw: unknown): Record<string, string> {
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

// One port item's location, tracked so `removeEntity` can sweep an entity's
// mirrors without scanning every project.
interface ItemRef {
  project: string;
  portId: string;
  handle: string;
  entityId: string;
}

// A (portId, handle) owner, tracked so `findMirrorItem` resolves without a scan
// and `setMirrorItem` can evict a previous owner.
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
    projectsMap(container),
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
  const node = projectNode(projectsMap(container), ref.project);
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
    const node = projectNode(projectsMap(container), project);
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

// Implements the sync state port against a namespaced key/value store. Storage
// is project-nested and port-grouped: the entity holds only hub-side location;
// each port holds its items keyed by handle. The in-memory indexes are built
// once from the migrated container and maintained on every write.
export class SyncStateAdapter implements SyncStatePort {
  private indexes: Indexes | null = null;

  constructor(private readonly storage: SyncStateStorage) {}

  // The namespaced container, running the chained one-shot migration on first
  // sight: legacy flat root -> container -> v2 entities -> v3 port-grouped.
  // The indexes are built once from the migrated container; writes maintain
  // them from then on.
  private async loadContainer(): Promise<Record<string, unknown>> {
    const data = await this.storage.load();
    if (migrateLegacyState(data)) {
      await this.storage.save(data);
    }
    const container = isRecord(data[SYNC_STATE_KEY])
      ? data[SYNC_STATE_KEY]
      : {};
    if (!isRecord(data[SYNC_STATE_KEY])) {
      data[SYNC_STATE_KEY] = container;
    }
    if (this.indexes === null) {
      let changed = false;
      if (migrateEntities(container)) {
        changed = true;
      }
      if (migrateV3(container)) {
        changed = true;
      }
      if (changed) {
        data[SYNC_STATE_KEY] = container;
        await this.storage.save(data);
      }
      this.indexes = buildIndexes(container);
    }
    return container;
  }

  // Load/mutate/save per operation, as before: proven with Obsidian storage.
  private async persist(container: Record<string, unknown>): Promise<void> {
    const data = await this.storage.load();
    data[SYNC_STATE_KEY] = container;
    await this.storage.save(data);
  }

  async getEntity(id: string): Promise<EntityRecord | null> {
    const container = await this.loadContainer();
    const project = this.indexes!.byEntityProject.get(id);
    if (project === undefined) {
      return null;
    }
    const node = projectNode(projectsMap(container), project);
    if (node === null) {
      return null;
    }
    const raw = entityMap(node)[id];
    return isRecord(raw) ? { id, notePath: str(raw.notePath) } : null;
  }

  async findByNotePath(notePath: string): Promise<EntityRecord | null> {
    await this.loadContainer();
    const id = this.indexes!.byNotePath.get(notePath);
    return id === undefined ? null : this.getEntity(id);
  }

  async setEntity(record: EntityRecord): Promise<void> {
    const container = await this.loadContainer();
    const indexes = this.indexes!;
    // The project key is derived from the note path (Projecten/<name>/... and
    // Archief/<name>/... both key <name>); WHY: the path convention IS the
    // project partition, so no caller has to pass the name for an entity.
    const project = projectFromNotePath(record.notePath);
    const previousProject = indexes.byEntityProject.get(record.id);
    const previousPath = indexes.byEntityPath.get(record.id);

    // Re-key: drop the old path index and, on a project move, the old nested
    // entity, before writing the new location. Items stay with their ports.
    if (
      previousPath !== undefined &&
      previousPath !== record.notePath &&
      indexes.byNotePath.get(previousPath) === record.id
    ) {
      indexes.byNotePath.delete(previousPath);
    }
    if (previousProject !== undefined && previousProject !== project) {
      const oldNode = projectNode(projectsMap(container), previousProject);
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
    await this.persist(container);
  }

  async removeEntity(id: string): Promise<void> {
    const container = await this.loadContainer();
    dropEntity(container, this.indexes!, id);
    await this.persist(container);
  }

  async listEntities(projectName: string): Promise<EntityRecord[]> {
    const container = await this.loadContainer();
    const node = projectNode(projectsMap(container), projectName);
    if (node === null) {
      return [];
    }
    return Object.entries(entityMap(node))
      .filter(([, raw]) => isRecord(raw))
      .map(([id, raw]) => ({
        id,
        notePath: str((raw as Record<string, unknown>).notePath),
      }));
  }

  async findMirrorItem(
    portId: string,
    handle: string,
  ): Promise<MirrorItem | null> {
    const container = await this.loadContainer();
    const owner = this.indexes!.byHandle.get(portId)?.get(handle);
    if (owner === undefined) {
      return null;
    }
    const node = projectNode(projectsMap(container), owner.project);
    if (node === null) {
      return null;
    }
    const port = portNode(node, portId);
    if (port === null) {
      return null;
    }
    return mapMirrorItem(itemsMap(port)[handle]);
  }

  async setMirrorItem(
    projectName: string,
    portId: string,
    handle: string,
    item: MirrorItem,
  ): Promise<void> {
    const container = await this.loadContainer();
    const indexes = this.indexes!;

    // A handle is a port-unique address, so a new owner evicts the previous
    // one's whole entity — matching the v2 record dedup, so no stale anchor
    // survives a re-capture or a twin recreation.
    const owner = indexes.byHandle.get(portId)?.get(handle);
    if (owner !== undefined && owner.entityId !== item.entityId) {
      dropEntity(container, indexes, owner.entityId);
    }

    const node = ensureProjectNode(ensureProjects(container), projectName);
    const port = ensurePortNode(node, portId);
    // A port's provider is its concrete service; a first item stamps it when
    // the caller has not written a port state yet.
    if (typeof port.provider !== 'string' || port.provider === '') {
      port.provider = portId;
    }
    ensureItemsMap(port)[handle] = { entityId: item.entityId, base: item.base };

    let handles = indexes.byHandle.get(portId);
    if (handles === undefined) {
      handles = new Map();
      indexes.byHandle.set(portId, handles);
    }
    handles.set(handle, { project: projectName, entityId: item.entityId });

    const refs = indexes.itemsByEntity.get(item.entityId) ?? [];
    if (
      !refs.some(
        (ref) =>
          ref.project === projectName &&
          ref.portId === portId &&
          ref.handle === handle,
      )
    ) {
      refs.push({ project: projectName, portId, handle, entityId: item.entityId });
      indexes.itemsByEntity.set(item.entityId, refs);
    }
    await this.persist(container);
  }

  async removeMirrorItem(
    projectName: string,
    portId: string,
    handle: string,
  ): Promise<void> {
    const container = await this.loadContainer();
    const node = projectNode(projectsMap(container), projectName);
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
        const refs = this.indexes!.itemsByEntity.get(entityId);
        if (refs !== undefined) {
          const filtered = refs.filter(
            (ref) =>
              !(
                ref.project === projectName &&
                ref.portId === portId &&
                ref.handle === handle
              ),
          );
          if (filtered.length === 0) {
            this.indexes!.itemsByEntity.delete(entityId);
          } else {
            this.indexes!.itemsByEntity.set(entityId, filtered);
          }
        }
      }
    }
    await this.persist(container);
  }

  async listMirrorItems(
    projectName: string,
    portId: string,
  ): Promise<Array<{ handle: string; item: MirrorItem }>> {
    const container = await this.loadContainer();
    const node = projectNode(projectsMap(container), projectName);
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
  }

  async getPortState(
    projectName: string,
    portId: string,
  ): Promise<PortState | null> {
    const container = await this.loadContainer();
    const node = projectNode(projectsMap(container), projectName);
    if (node === null) {
      return null;
    }
    const port = portNode(node, portId);
    return port === null ? null : mapPortState(port, portId);
  }

  async setPortState(
    projectName: string,
    portId: string,
    state: PortState,
  ): Promise<void> {
    const container = await this.loadContainer();
    const node = ensureProjectNode(ensureProjects(container), projectName);
    const port = ensurePortNode(node, portId);
    port.provider = state.provider;
    port.lastPoll = state.lastPoll;
    port.lanes = state.lanes;
    port.tags = state.tags;
    await this.persist(container);
  }

  async setIdentity(
    projectName: string,
    identity: ProjectIdentityData,
  ): Promise<void> {
    const container = await this.loadContainer();
    ensureProjectNode(ensureProjects(container), projectName).identity =
      identity;
    await this.persist(container);
  }

  async getIdentity(projectName: string): Promise<ProjectIdentityData | null> {
    const container = await this.loadContainer();
    const node = projectNode(projectsMap(container), projectName);
    const raw = node === null ? undefined : node.identity;
    return isRecord(raw) ? this.mapIdentity(raw) : null;
  }

  async getLastProjectUpdate(projectName: string): Promise<string | null> {
    const container = await this.loadContainer();
    const node = projectNode(projectsMap(container), projectName);
    const raw = node === null ? undefined : node.lastProjectUpdate;
    return typeof raw === 'string' ? raw : null;
  }

  async setLastProjectUpdate(projectName: string, iso: string): Promise<void> {
    const container = await this.loadContainer();
    ensureProjectNode(ensureProjects(container), projectName).lastProjectUpdate =
      iso;
    await this.persist(container);
  }

  async getArchiveBaseline(
    projectName: string,
  ): Promise<ArchiveBaselineData | null> {
    const container = await this.loadContainer();
    const node = projectNode(projectsMap(container), projectName);
    const raw = node === null ? undefined : node.archive;
    return isRecord(raw) ? this.mapArchiveBaseline(raw) : null;
  }

  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    const container = await this.loadContainer();
    ensureProjectNode(ensureProjects(container), projectName).archive = baseline;
    await this.persist(container);
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
    const container = await this.loadContainer();
    const node = projectNode(projectsMap(container), projectName);
    const raw = node === null ? undefined : node.watch;
    return isRecord(raw)
      ? this.mapWatchState(raw)
      : { etag: null, cursor: null };
  }

  async setWatchState(
    projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    const container = await this.loadContainer();
    ensureProjectNode(ensureProjects(container), projectName).watch = state;
    await this.persist(container);
  }

  private mapWatchState(raw: Record<string, unknown>): WatchStateData {
    return {
      etag: typeof raw.etag === 'string' ? raw.etag : null,
      cursor: typeof raw.cursor === 'string' ? raw.cursor : null,
    };
  }

  private mapIdentity(raw: Record<string, unknown>): ProjectIdentityData {
    return {
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
    };
  }
}
