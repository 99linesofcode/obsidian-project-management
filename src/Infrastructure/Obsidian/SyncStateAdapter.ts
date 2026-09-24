import type { ArchiveBaselineData } from '../../Domain/DataTransferObjects/ArchiveBaselineData.js';
import type { ProjectIdentityData } from '../../Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TodoistProjectStateData } from '../../Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { TodoistStateData } from '../../Domain/DataTransferObjects/TodoistStateData.js';
import type { WatchStateData } from '../../Domain/DataTransferObjects/WatchStateData.js';
import type { Status } from '../../Domain/Models/Status.js';
import type { SyncStatePort } from '../../Domain/Ports/SyncStatePort.js';

// The storage the adapter persists through. main.ts binds the plugin's
// loadData/saveData so records live in the plugin's data.json.
export interface SyncStateStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Implements the sync state port against a flat key/value store. Records are
// namespaced by kind: status.<url>, identity.<projectName>,
// projectUpdate.<projectName>, archiveBaseline.<projectName>,
// watch.<projectName>, todoistProject.<projectName> and
// todoistItem.<notePath>.
export class SyncStateAdapter implements SyncStatePort {
  constructor(private readonly storage: SyncStateStorage) {}

  async get(url: string): Promise<Status | null> {
    const data = await this.storage.load();
    const raw = data[`status.${url}`];
    return isRecord(raw) ? this.mapStatus(raw) : null;
  }

  async set(status: Status): Promise<void> {
    const data = await this.storage.load();
    data[`status.${status.url}`] = status;
    await this.storage.save(data);
  }

  async findByNotePath(notePath: string): Promise<Status | null> {
    const data = await this.storage.load();
    for (const [key, raw] of Object.entries(data)) {
      if (
        key.startsWith('status.') &&
        isRecord(raw) &&
        raw.notePath === notePath
      ) {
        return this.mapStatus(raw);
      }
    }
    return null;
  }

  async remove(url: string): Promise<void> {
    const data = await this.storage.load();
    delete data[`status.${url}`];
    await this.storage.save(data);
  }

  async list(): Promise<Status[]> {
    const data = await this.storage.load();
    return Object.entries(data)
      .filter(([key, raw]) => key.startsWith('status.') && isRecord(raw))
      .map(([, raw]) => this.mapStatus(raw as Record<string, unknown>));
  }

  private mapStatus(raw: Record<string, unknown>): Status {
    return {
      url: typeof raw.url === 'string' ? raw.url : '',
      remoteId: typeof raw.remoteId === 'number' ? raw.remoteId : 0,
      notePath: typeof raw.notePath === 'string' ? raw.notePath : '',
      lastSyncedBodyHash:
        typeof raw.lastSyncedBodyHash === 'string'
          ? raw.lastSyncedBodyHash
          : '',
      lastSyncedRemoteUpdatedAt:
        typeof raw.lastSyncedRemoteUpdatedAt === 'string'
          ? raw.lastSyncedRemoteUpdatedAt
          : '',
      lastSyncedStatus: raw.lastSyncedStatus === 'done' ? 'done' : 'open',
      lastSyncedTitle:
        typeof raw.lastSyncedTitle === 'string' ? raw.lastSyncedTitle : '',
    };
  }

  async setIdentity(
    projectName: string,
    identity: ProjectIdentityData,
  ): Promise<void> {
    const data = await this.storage.load();
    data[`identity.${projectName}`] = identity;
    await this.storage.save(data);
  }

  async getIdentity(projectName: string): Promise<ProjectIdentityData | null> {
    const data = await this.storage.load();
    const raw = data[`identity.${projectName}`];
    return isRecord(raw) ? this.mapIdentity(raw) : null;
  }

  async getLastProjectUpdate(projectName: string): Promise<string | null> {
    const data = await this.storage.load();
    const raw = data[`projectUpdate.${projectName}`];
    return typeof raw === 'string' ? raw : null;
  }

  async setLastProjectUpdate(projectName: string, iso: string): Promise<void> {
    const data = await this.storage.load();
    data[`projectUpdate.${projectName}`] = iso;
    await this.storage.save(data);
  }

  async getArchiveBaseline(
    projectName: string,
  ): Promise<ArchiveBaselineData | null> {
    const data = await this.storage.load();
    const raw = data[`archiveBaseline.${projectName}`];
    return isRecord(raw) ? this.mapArchiveBaseline(raw) : null;
  }

  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    const data = await this.storage.load();
    data[`archiveBaseline.${projectName}`] = baseline;
    await this.storage.save(data);
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
    const data = await this.storage.load();
    const raw = data[`watch.${projectName}`];
    return isRecord(raw)
      ? this.mapWatchState(raw)
      : { etag: null, cursor: null };
  }

  async setWatchState(
    projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    const data = await this.storage.load();
    data[`watch.${projectName}`] = state;
    await this.storage.save(data);
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
    const data = await this.storage.load();
    const raw = data[`todoistProject.${projectName}`];
    return isRecord(raw) ? this.mapTodoistProjectState(raw) : null;
  }

  async setTodoistProjectState(
    projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    const data = await this.storage.load();
    data[`todoistProject.${projectName}`] = state;
    await this.storage.save(data);
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

  async getTodoistState(notePath: string): Promise<TodoistStateData | null> {
    const data = await this.storage.load();
    const raw = data[`todoistItem.${notePath}`];
    return isRecord(raw) ? this.mapTodoistState(raw) : null;
  }

  async setTodoistState(
    notePath: string,
    state: TodoistStateData,
  ): Promise<void> {
    const data = await this.storage.load();
    // An item is anchored by its todoistId; the notePath is only where it
    // currently lives. A rename re-keys the record, so any other record for the
    // same todoistId is evicted here rather than left as a stale anchor behind.
    if (state.todoistId !== '') {
      for (const [key, raw] of Object.entries(data)) {
        if (
          key !== `todoistItem.${notePath}` &&
          key.startsWith('todoistItem.') &&
          isRecord(raw) &&
          raw.todoistId === state.todoistId
        ) {
          delete data[key];
        }
      }
    }
    data[`todoistItem.${notePath}`] = state;
    await this.storage.save(data);
  }

  async listTodoistStates(): Promise<TodoistStateData[]> {
    const data = await this.storage.load();
    return Object.entries(data)
      .filter(([key, raw]) => key.startsWith('todoistItem.') && isRecord(raw))
      .map(([, raw]) => this.mapTodoistState(raw as Record<string, unknown>));
  }

  // Deletes the record outright, rather than overwriting it with an empty one:
  // deletion propagation needs the anchor gone so the next capture pass does
  // not treat the (deleted) twin as an existing mirror.
  async removeTodoistState(notePath: string): Promise<void> {
    const data = await this.storage.load();
    delete data[`todoistItem.${notePath}`];
    await this.storage.save(data);
  }

  private mapTodoistState(raw: Record<string, unknown>): TodoistStateData {
    const state: TodoistStateData = {
      todoistId: typeof raw.todoistId === 'string' ? raw.todoistId : '',
      notePath: typeof raw.notePath === 'string' ? raw.notePath : '',
      lastSyncedHash:
        typeof raw.lastSyncedHash === 'string' ? raw.lastSyncedHash : '',
      lastSyncedCompleted: raw.lastSyncedCompleted === true,
    };
    // The per-field bases are optional: an old record simply lacks them.
    if (typeof raw.lastSyncedContent === 'string') {
      state.lastSyncedContent = raw.lastSyncedContent;
    }
    if (raw.lastSyncedLane === null || typeof raw.lastSyncedLane === 'string') {
      state.lastSyncedLane = raw.lastSyncedLane;
    }
    if (
      raw.lastSyncedParent === null ||
      typeof raw.lastSyncedParent === 'string'
    ) {
      state.lastSyncedParent = raw.lastSyncedParent;
    }
    return state;
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
