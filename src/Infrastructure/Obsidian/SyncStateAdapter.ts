import type { ArchiveBaselineData } from '../../Domain/DataTransferObjects/ArchiveBaselineData.js';
import type { ProjectIdentityData } from '../../Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../../Domain/DataTransferObjects/TaskData.js';
import type { TodoistProjectStateData } from '../../Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { WatchStateData } from '../../Domain/DataTransferObjects/WatchStateData.js';
import type { SyncStatePort } from '../../Domain/Ports/SyncStatePort.js';

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

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
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

// Implements the sync state port against a namespaced key/value store. The
// container holds the same seven namespaces as before, but the per-entity
// records are now CANONICAL: `status.<url>` and `todoistItem.<notePath>` hold
// the canonical `TaskData` the mappers produce (the same shape the diff reads),
// not the provider-shaped `Status` / `TodoistStateData` fragments. One uniform
// record per entity.
export class SyncStateAdapter implements SyncStatePort {
  constructor(private readonly storage: SyncStateStorage) {}

  // The namespaced container, migrating the legacy flat root on first sight.
  private async loadState(): Promise<Record<string, unknown>> {
    const data = await this.storage.load();
    if (migrateLegacyState(data)) {
      await this.storage.save(data);
    }
    const root = data[SYNC_STATE_KEY];
    return isRecord(root) ? root : {};
  }

  private async saveState(root: Record<string, unknown>): Promise<void> {
    const data = await this.storage.load();
    data[SYNC_STATE_KEY] = root;
    await this.storage.save(data);
  }

  async get(url: string): Promise<TaskData | null> {
    const root = await this.loadState();
    const raw = root[`status.${url}`];
    return isRecord(raw) ? mapTask(raw) : null;
  }

  async set(status: TaskData): Promise<void> {
    const root = await this.loadState();
    root[`status.${status.url}`] = status;
    await this.saveState(root);
  }

  async findByNotePath(notePath: string): Promise<TaskData | null> {
    const root = await this.loadState();
    for (const [key, raw] of Object.entries(root)) {
      if (key.startsWith('status.') && isRecord(raw)) {
        const record = mapTask(raw);
        if (record.notePath === notePath) {
          return record;
        }
      }
    }
    return null;
  }

  async remove(url: string): Promise<void> {
    const root = await this.loadState();
    delete root[`status.${url}`];
    await this.saveState(root);
  }

  async list(): Promise<TaskData[]> {
    const root = await this.loadState();
    return Object.entries(root)
      .filter(([key, raw]) => key.startsWith('status.') && isRecord(raw))
      .map(([, raw]) => mapTask(raw as Record<string, unknown>));
  }

  async setIdentity(
    projectName: string,
    identity: ProjectIdentityData,
  ): Promise<void> {
    const root = await this.loadState();
    root[`identity.${projectName}`] = identity;
    await this.saveState(root);
  }

  async getIdentity(projectName: string): Promise<ProjectIdentityData | null> {
    const root = await this.loadState();
    const raw = root[`identity.${projectName}`];
    return isRecord(raw) ? this.mapIdentity(raw) : null;
  }

  async getLastProjectUpdate(projectName: string): Promise<string | null> {
    const root = await this.loadState();
    const raw = root[`projectUpdate.${projectName}`];
    return typeof raw === 'string' ? raw : null;
  }

  async setLastProjectUpdate(projectName: string, iso: string): Promise<void> {
    const root = await this.loadState();
    root[`projectUpdate.${projectName}`] = iso;
    await this.saveState(root);
  }

  async getArchiveBaseline(
    projectName: string,
  ): Promise<ArchiveBaselineData | null> {
    const root = await this.loadState();
    const raw = root[`archiveBaseline.${projectName}`];
    return isRecord(raw) ? this.mapArchiveBaseline(raw) : null;
  }

  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    const root = await this.loadState();
    root[`archiveBaseline.${projectName}`] = baseline;
    await this.saveState(root);
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
    const root = await this.loadState();
    const raw = root[`watch.${projectName}`];
    return isRecord(raw)
      ? this.mapWatchState(raw)
      : { etag: null, cursor: null };
  }

  async setWatchState(
    projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    const root = await this.loadState();
    root[`watch.${projectName}`] = state;
    await this.saveState(root);
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
    const root = await this.loadState();
    const raw = root[`todoistProject.${projectName}`];
    return isRecord(raw) ? this.mapTodoistProjectState(raw) : null;
  }

  async setTodoistProjectState(
    projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    const root = await this.loadState();
    root[`todoistProject.${projectName}`] = state;
    await this.saveState(root);
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

  async getTodoistState(notePath: string): Promise<TaskData | null> {
    const root = await this.loadState();
    const raw = root[`todoistItem.${notePath}`];
    return isRecord(raw) ? mapTodoistTask(raw) : null;
  }

  async setTodoistState(notePath: string, state: TaskData): Promise<void> {
    const root = await this.loadState();
    // An item is anchored by its todoistId; the notePath is only where it
    // currently lives. A rename re-keys the record, so any other record for the
    // same todoistId is evicted here rather than left as a stale anchor behind.
    if (state.todoistId !== '') {
      for (const [key, raw] of Object.entries(root)) {
        if (
          key !== `todoistItem.${notePath}` &&
          key.startsWith('todoistItem.') &&
          isRecord(raw) &&
          raw.todoistId === state.todoistId
        ) {
          delete root[key];
        }
      }
    }
    root[`todoistItem.${notePath}`] = state;
    await this.saveState(root);
  }

  async listTodoistStates(): Promise<TaskData[]> {
    const root = await this.loadState();
    return Object.entries(root)
      .filter(([key, raw]) => key.startsWith('todoistItem.') && isRecord(raw))
      .map(([, raw]) => mapTodoistTask(raw as Record<string, unknown>));
  }

  // Deletes the record outright, rather than overwriting it with an empty one:
  // deletion propagation needs the anchor gone so the next capture pass does
  // not treat the (deleted) twin as an existing mirror.
  async removeTodoistState(notePath: string): Promise<void> {
    const root = await this.loadState();
    delete root[`todoistItem.${notePath}`];
    await this.saveState(root);
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

// The canonical per-entity record: the mapper's TaskData shape, stored whole.
// The GitHub body is the provider-comparable fingerprint (the issue-body hash),
// so the pipeline compares hashes; every other field is the canonical content.
function canonicalTask(raw: Record<string, unknown>): TaskData {
  return {
    url: str(raw.url),
    remoteId: num(raw.remoteId),
    nodeId: str(raw.nodeId),
    todoistId: str(raw.todoistId),
    notePath: str(raw.notePath),
    title: str(raw.title),
    body: str(raw.body),
    status: str(raw.status),
    completed: raw.completed === true,
    parent: stringOrNull(raw.parent),
    labels: Array.isArray(raw.labels)
      ? raw.labels.filter((label): label is string => typeof label === 'string')
      : [],
    updatedAt: str(raw.updatedAt),
  };
}

// A `status.<url>` record. A canonical record already carries the TaskData
// fields; a pre-t5 provider-shaped `Status` record (lastSynced*) is mapped
// across. The lane name is preserved verbatim — the old adapter collapsed it to
// 'done'|'open', losing every other lane.
function mapTask(raw: Record<string, unknown>): TaskData {
  if (typeof raw.title === 'string' && typeof raw.status === 'string') {
    return canonicalTask(raw);
  }
  return {
    url: str(raw.url),
    remoteId: num(raw.remoteId),
    nodeId: '',
    todoistId: '',
    notePath: str(raw.notePath),
    title: str(raw.lastSyncedTitle),
    body: str(raw.lastSyncedBodyHash),
    status: str(raw.lastSyncedStatus),
    // The legacy record never stored a completion bit; the pipeline derives it
    // from the lane at diff time, so a default here is not load-bearing.
    completed: raw.lastSyncedStatus === 'done',
    parent: null,
    labels: [],
    updatedAt: str(raw.lastSyncedRemoteUpdatedAt),
  };
}

// A `todoistItem.<notePath>` record, in the same canonical TaskData shape. A
// to-do projects onto the task shape (status '' = lane not controlled, parent =
// the twin parent id) so one uniform record covers tasks and to-dos. A pre-t5
// `TodoistStateData` record (lastSynced*) is mapped across.
function mapTodoistTask(raw: Record<string, unknown>): TaskData {
  if (typeof raw.title === 'string' && typeof raw.status === 'string') {
    return canonicalTask(raw);
  }
  return {
    url: '',
    remoteId: 0,
    nodeId: '',
    todoistId: str(raw.todoistId),
    notePath: str(raw.notePath),
    title: str(raw.lastSyncedContent),
    body: '',
    status: raw.lastSyncedLane === null ? '' : str(raw.lastSyncedLane),
    completed: raw.lastSyncedCompleted === true,
    parent: stringOrNull(raw.lastSyncedParent),
    labels: [],
    updatedAt: '',
  };
}
