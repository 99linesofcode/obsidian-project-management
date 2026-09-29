import type { ArchiveBaselineData } from '../../Domain/DataTransferObjects/ArchiveBaselineData.js';
import { Mirror } from '../../Domain/DataTransferObjects/Mirror.js';
import type { ProjectIdentityData } from '../../Domain/DataTransferObjects/ProjectIdentityData.js';
import { TaskData } from '../../Domain/DataTransferObjects/TaskData.js';
import type { TodoistProjectStateData } from '../../Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { WatchStateData } from '../../Domain/DataTransferObjects/WatchStateData.js';
import type {
  EntityRecord,
  SyncStatePort,
} from '../../Domain/Ports/SyncStatePort.js';
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

// The registry itself lives at `syncState.entities.<uuid>`, beside the
// project-level namespaces that are unchanged.
const ENTITIES_KEY = 'entities';

const STATUS_PREFIX = 'status.';
const TODOIST_ITEM_PREFIX = 'todoistItem.';

// The seven namespaces. A legacy record is any root key carrying one of these
// prefixes; after migration every record lives inside the container.
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
// registry. A `status.<url>` record becomes an entity with a `github` mirror; a
// `todoistItem.<notePath>` record merges into the entity at that path, or
// creates a Todoist-only entity when none exists (a vault to-do has no GitHub
// issue and legitimately has no GitHub record). The legacy keys are deleted
// afterwards, so a second load is a no-op. Never drops data: a record that
// cannot be parsed is left in place rather than discarded.
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

// The in-memory lookup indexes, rebuilt once from the container on first load
// and maintained by set/remove afterwards. byNotePath is the primary lookup;
// byHandle maps a provider's address to the entity that owns it.
interface Indexes {
  byNotePath: Map<string, string>;
  byHandle: Map<string, Map<string, string>>;
}

function buildIndexes(container: Record<string, unknown>): Indexes {
  const indexes: Indexes = {
    byNotePath: new Map(),
    byHandle: new Map(),
  };
  for (const [id, raw] of Object.entries(entityMap(container))) {
    if (!isRecord(raw)) {
      continue;
    }
    const record = mapEntity(raw);
    indexes.byNotePath.set(record.notePath, id);
    for (const [provider, mirror] of Object.entries(record.mirrors)) {
      addHandle(indexes.byHandle, provider, mirror.handle, id);
    }
  }
  return indexes;
}

// An empty handle is not an address; indexing it would make unrelated records
// collide, so it is skipped.
function addHandle(
  byHandle: Map<string, Map<string, string>>,
  provider: string,
  handle: string,
  id: string,
): void {
  if (handle === '') {
    return;
  }
  let handles = byHandle.get(provider);
  if (handles === undefined) {
    handles = new Map();
    byHandle.set(provider, handles);
  }
  handles.set(handle, id);
}

// Removes a record from the in-memory entity map and clears every index entry
// that pointed at it. Called before evicting a stale anchor or re-keying.
function dropRecord(
  entities: Record<string, unknown>,
  indexes: Indexes,
  id: string,
): void {
  const raw = entities[id];
  delete entities[id];
  if (!isRecord(raw)) {
    return;
  }
  const record = mapEntity(raw);
  if (indexes.byNotePath.get(record.notePath) === id) {
    indexes.byNotePath.delete(record.notePath);
  }
  for (const [provider, mirror] of Object.entries(record.mirrors)) {
    const handles = indexes.byHandle.get(provider);
    if (handles !== undefined && handles.get(mirror.handle) === id) {
      handles.delete(mirror.handle);
      if (handles.size === 0) {
        indexes.byHandle.delete(provider);
      }
    }
  }
}

function entityMap(
  container: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(container[ENTITIES_KEY]) ? container[ENTITIES_KEY] : {};
}

function ensureEntityMap(
  container: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(container[ENTITIES_KEY])) {
    container[ENTITIES_KEY] = {};
  }
  return entityMap(container);
}

function readEntity(
  container: Record<string, unknown>,
  id: string,
): EntityRecord | null {
  const raw = entityMap(container)[id];
  return isRecord(raw) ? mapEntity(raw) : null;
}

function mapEntity(raw: Record<string, unknown>): EntityRecord {
  const mirrors: Record<string, Mirror> = {};
  if (isRecord(raw.mirrors)) {
    for (const [provider, value] of Object.entries(raw.mirrors)) {
      if (isRecord(value)) {
        mirrors[provider] = new Mirror(str(value.handle), mapBase(value.base));
      }
    }
  }
  return { id: str(raw.id), notePath: str(raw.notePath), mirrors };
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

// Implements the sync state port against a namespaced key/value store. The
// container holds the project-level namespaces unchanged plus the registry at
// `entities.<uuid>`: one record per hub entity, joining both halves.
export class SyncStateAdapter implements SyncStatePort {
  private indexes: Indexes | null = null;

  constructor(private readonly storage: SyncStateStorage) {}

  // The namespaced container, migrating the legacy flat root and the legacy
  // per-entity stores on first sight. The indexes are built once from the
  // migrated container; set/remove maintain them from then on.
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
      if (migrateEntities(container)) {
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

  async get(id: string): Promise<EntityRecord | null> {
    const container = await this.loadContainer();
    return readEntity(container, id);
  }

  async findByNotePath(notePath: string): Promise<EntityRecord | null> {
    const container = await this.loadContainer();
    const id = this.indexes!.byNotePath.get(notePath);
    return id === undefined ? null : readEntity(container, id);
  }

  async findByMirror(
    provider: string,
    handle: string,
  ): Promise<EntityRecord | null> {
    const container = await this.loadContainer();
    const id = this.indexes!.byHandle.get(provider)?.get(handle);
    return id === undefined ? null : readEntity(container, id);
  }

  async set(record: EntityRecord): Promise<void> {
    const container = await this.loadContainer();
    const entities = ensureEntityMap(container);
    const indexes = this.indexes!;

    // A mirror is anchored by its handle, not by the note path: evict any OTHER
    // record already claiming one of this record's handles, so a rename (or a
    // re-capture) cannot leave a stale anchor behind. Generalized from the old
    // adapter's todoistId dedup.
    for (const [provider, mirror] of Object.entries(record.mirrors)) {
      const owner = indexes.byHandle.get(provider)?.get(mirror.handle);
      if (owner !== undefined && owner !== record.id) {
        dropRecord(entities, indexes, owner);
      }
    }

    // Re-key this record: drop its previous path/handles before re-adding, so a
    // rename moves the indexes rather than leaving the old path mapped.
    if (entities[record.id] !== undefined) {
      dropRecord(entities, indexes, record.id);
    }

    entities[record.id] = record;
    indexes.byNotePath.set(record.notePath, record.id);
    for (const [provider, mirror] of Object.entries(record.mirrors)) {
      addHandle(indexes.byHandle, provider, mirror.handle, record.id);
    }

    await this.persist(container);
  }

  async remove(id: string): Promise<void> {
    const container = await this.loadContainer();
    const entities = ensureEntityMap(container);
    if (entities[id] !== undefined) {
      dropRecord(entities, this.indexes!, id);
    }
    await this.persist(container);
  }

  async list(): Promise<EntityRecord[]> {
    const container = await this.loadContainer();
    return Object.values(entityMap(container)).filter(isRecord).map(mapEntity);
  }

  async setIdentity(
    projectName: string,
    identity: ProjectIdentityData,
  ): Promise<void> {
    const root = await this.loadContainer();
    root[`identity.${projectName}`] = identity;
    await this.persist(root);
  }

  async getIdentity(projectName: string): Promise<ProjectIdentityData | null> {
    const root = await this.loadContainer();
    const raw = root[`identity.${projectName}`];
    return isRecord(raw) ? this.mapIdentity(raw) : null;
  }

  async getLastProjectUpdate(projectName: string): Promise<string | null> {
    const root = await this.loadContainer();
    const raw = root[`projectUpdate.${projectName}`];
    return typeof raw === 'string' ? raw : null;
  }

  async setLastProjectUpdate(projectName: string, iso: string): Promise<void> {
    const root = await this.loadContainer();
    root[`projectUpdate.${projectName}`] = iso;
    await this.persist(root);
  }

  async getArchiveBaseline(
    projectName: string,
  ): Promise<ArchiveBaselineData | null> {
    const root = await this.loadContainer();
    const raw = root[`archiveBaseline.${projectName}`];
    return isRecord(raw) ? this.mapArchiveBaseline(raw) : null;
  }

  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    const root = await this.loadContainer();
    root[`archiveBaseline.${projectName}`] = baseline;
    await this.persist(root);
  }

  private mapArchiveBaseline(
    raw: Record<string, unknown>,
  ): ArchiveBaselineData {
    return {
      locationArchived: raw.locationArchived === true,
      closed: raw.closed === true,
    };
  }

  async getWatchState(projectName: string): Promise<WatchStateData> {
    const root = await this.loadContainer();
    const raw = root[`watch.${projectName}`];
    return isRecord(raw)
      ? this.mapWatchState(raw)
      : { etag: null, cursor: null };
  }

  async setWatchState(
    projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    const root = await this.loadContainer();
    root[`watch.${projectName}`] = state;
    await this.persist(root);
  }

  private mapWatchState(raw: Record<string, unknown>): WatchStateData {
    return {
      etag: typeof raw.etag === 'string' ? raw.etag : null,
      cursor: typeof raw.cursor === 'string' ? raw.cursor : null,
    };
  }

  async getTodoistProjectState(
    projectName: string,
  ): Promise<TodoistProjectStateData | null> {
    const root = await this.loadContainer();
    const raw = root[`todoistProject.${projectName}`];
    return isRecord(raw) ? this.mapTodoistProjectState(raw) : null;
  }

  async setTodoistProjectState(
    projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    const root = await this.loadContainer();
    root[`todoistProject.${projectName}`] = state;
    await this.persist(root);
  }

  private mapTodoistProjectState(
    raw: Record<string, unknown>,
  ): TodoistProjectStateData {
    const sections: Record<string, string> = {};
    if (isRecord(raw.sections)) {
      for (const [name, id] of Object.entries(raw.sections)) {
        if (typeof id === 'string') {
          sections[name] = id;
        }
      }
    }
    return {
      sections,
      lastCompletedPoll:
        typeof raw.lastCompletedPoll === 'string' ? raw.lastCompletedPoll : '',
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
