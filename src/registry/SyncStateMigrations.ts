import { isRecord } from '../shared/isRecord.js';
import { Mirror } from '../shared/Mirror.js';
import { TaskData } from '../shared/TaskData.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import { projectFromNotePath } from '../projects/projectFromNotePath.js';
import {
  ENTITIES_KEY,
  FULL_SCAN_PENDING_KEY,
  PROJECTS_KEY,
  SYNC_STATE_KEY,
  VERSION,
  ensureEntityMap,
  ensureItemsMap,
  ensurePortNode,
  ensureProjectNode,
  readProjectsMap,
  str,
  stringOrNull,
} from './SyncStateSchema.js';

// The one-shot migrations of the pre-v3 layouts into the current container.
// Every function here is version-gated and idempotent; the adapter calls the
// chain once per load.

export const STATUS_PREFIX = 'status.';
export const TODOIST_ITEM_PREFIX = 'todoistItem.';

// The flat project-level namespaces of the pre-v3 layout. Each folds into its
// `projects.<name>` home; the two per-entity prefixes are handled by
// `migrateEntities` before the v3 fold.
export const LEGACY_PROJECT_PREFIXES: ReadonlyArray<[string, string]> = [
  ['identity.', 'identity'],
  ['projectUpdate.', 'lastProjectUpdate'],
  ['archiveBaseline.', 'archive'],
  ['watch.', 'watch'],
];

// A legacy record is any root key carrying one of these prefixes; after
// migration every record lives inside the container.
export const LEGACY_PREFIXES = [
  'status.',
  'identity.',
  'projectUpdate.',
  'archiveBaseline.',
  'watch.',
  'todoistProject.',
  'todoistItem.',
] as const;

// The canonical archive node a migration writes. The legacy store carried only
// {locationArchived, closed} and predates the stamp. locationArchived survives
// because the lifecycle merge still reads it; archivedAt follows the migrated
// convention ('' for an already-archived project whose transition time is
// unknown, null while active), matching mapArchiveBaseline's fallback.
export function normalizeArchive(raw: unknown): Record<string, unknown> {
  const record = isRecord(raw) ? raw : {};
  const locationArchived = record.locationArchived === true;
  return {
    locationArchived,
    closed: record.closed === true,
    archivedAt:
      typeof record.archivedAt === 'string'
        ? record.archivedAt
        : locationArchived
          ? ''
          : null,
  };
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
  // v1 -> v2 only. An already-current (or NEWER) container is never re-migrated:
  // running this on a v3 container with a stray legacy key would strand a v2
  // `entities` map that the version-gated v3 fold will not pick up.
  if (typeof container.version === 'number' && container.version >= VERSION) {
    return false;
  }
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
  // Version-dispatched and one-way: an already-current container is untouched,
  // and a NEWER container is never re-migrated (its schema is not ours to
  // rewrite — leave it byte-for-byte). Only an unversioned or older container
  // migrates.
  if (typeof container.version === 'number' && container.version >= VERSION) {
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
      const node = ensureProjectNode(projects, name);
      // WHY normalize the archive: the legacy node carried only
      // {locationArchived, closed} and predates the stamp, so without this the
      // persisted shape lags the schema until the next setArchiveBaseline write.
      // locationArchived is KEPT: ReconcileProjectLifecycleAction still reads it
      // as the vault-location arm of the three-way merge, so dropping it from
      // the persisted node would silently reopen every archived project. The
      // canonical persisted node therefore carries all three fields.
      node[field] =
        field === 'archive' ? normalizeArchive(container[key]) : container[key];
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
export interface LegacyFields {
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
export function parseLegacyStatusRecord(raw: Record<string, unknown>): LegacyFields {
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
export function parseLegacyTodoRecord(raw: Record<string, unknown>): LegacyFields {
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
export function migratedCompletedAt(completed: boolean): string | null {
  return completed ? '' : null;
}

// The GitHub base is a diff view whose body already held the issue-body digest,
// so it is stored as-is — re-hashing would change the fingerprint and make
// every migrated task look locally edited.
export function githubBase(id: string, fields: LegacyFields): TaskData {
  return new TaskData({
    id: id,
    notePath: fields.notePath,
    mirrors: {},
    title: fields.title,
    body: fields.body,
    status: fields.status,
    completedAt: migratedCompletedAt(fields.completed),
    type: '',
    parent: null,
    createdAt: null,
    updatedAt: fields.updatedAt || null,
  });
}

// A to-do base has no body text in the old store; hashing it makes the base a
// proper diff view (a base's body field always carries a digest). Its parent is
// carried across.
export function todoistBase(
  id: string,
  notePath: string,
  fields: LegacyFields,
): TaskData {
  return toDiffViewWithBody(
    new TaskData({
      id: id,
      notePath: notePath,
      mirrors: {},
      title: fields.title,
      body: fields.body,
      status: fields.status,
      completedAt: migratedCompletedAt(fields.completed),
      type: '',
      parent: fields.parent,
      createdAt: null,
      updatedAt: fields.updatedAt || null,
    }),
  );
}

// Seeds the per-project one-shot forced-scan marker on a store that predates
// parent tracking, and folds away the legacy container-level flag (which only
// ever forced the first project's scan). Returns whether it changed anything.
export function seedFullScanMarkers(container: Record<string, unknown>): boolean {
  let changed = false;
  if (container[FULL_SCAN_PENDING_KEY] !== undefined) {
    delete container[FULL_SCAN_PENDING_KEY];
    changed = true;
  }
  for (const rawProject of Object.values(readProjectsMap(container))) {
    if (!isRecord(rawProject)) {
      continue;
    }
    if (rawProject[FULL_SCAN_PENDING_KEY] === undefined) {
      rawProject[FULL_SCAN_PENDING_KEY] = true;
      changed = true;
    }
  }
  return changed;
}
