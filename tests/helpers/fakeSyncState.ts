import type { ArchiveBaselineData } from '../../src/Domain/DataTransferObjects/ArchiveBaselineData.js';
import type { ProjectIdentityData } from '../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TodoistProjectStateData } from '../../src/Domain/DataTransferObjects/TodoistProjectStateData.js';
import type { WatchStateData } from '../../src/Domain/DataTransferObjects/WatchStateData.js';
import type {
  EntityRecord,
  SyncStatePort,
} from '../../src/Domain/Ports/SyncStatePort.js';

// An in-memory SyncStatePort: the uuid-keyed registry plus the project-level
// namespaces. It mirrors the adapter's indexes (findByNotePath/findByMirror)
// and its handle dedup, so an action under test sees the same lookups it would
// against the real store.
export class FakeSyncState implements SyncStatePort {
  records = new Map<string, EntityRecord>();
  identities = new Map<string, ProjectIdentityData>();
  lastUpdates = new Map<string, string>();
  baselines = new Map<string, ArchiveBaselineData>();
  watches = new Map<string, WatchStateData>();
  todoistProjects = new Map<string, TodoistProjectStateData>();
  setCalls: EntityRecord[] = [];
  removed: string[] = [];

  async get(id: string): Promise<EntityRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByNotePath(notePath: string): Promise<EntityRecord | null> {
    for (const record of this.records.values()) {
      if (record.notePath === notePath) {
        return record;
      }
    }
    return null;
  }

  async findByMirror(
    provider: string,
    handle: string,
  ): Promise<EntityRecord | null> {
    for (const record of this.records.values()) {
      if (record.mirrors[provider]?.handle === handle) {
        return record;
      }
    }
    return null;
  }

  async set(record: EntityRecord): Promise<void> {
    // A mirror is anchored by its handle: evict any other record claiming one
    // of this record's handles, matching the adapter's dedup.
    for (const [id, other] of this.records) {
      if (id === record.id) {
        continue;
      }
      for (const [provider, mirror] of Object.entries(record.mirrors)) {
        if (other.mirrors[provider]?.handle === mirror.handle) {
          this.records.delete(id);
        }
      }
    }
    this.records.set(record.id, record);
    this.setCalls.push(record);
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
    this.removed.push(id);
  }

  async list(): Promise<EntityRecord[]> {
    return [...this.records.values()];
  }

  async setIdentity(
    projectName: string,
    identity: ProjectIdentityData,
  ): Promise<void> {
    this.identities.set(projectName, identity);
  }

  async getIdentity(projectName: string): Promise<ProjectIdentityData | null> {
    return this.identities.get(projectName) ?? null;
  }

  async getLastProjectUpdate(projectName: string): Promise<string | null> {
    return this.lastUpdates.get(projectName) ?? null;
  }

  async setLastProjectUpdate(projectName: string, iso: string): Promise<void> {
    this.lastUpdates.set(projectName, iso);
  }

  async getArchiveBaseline(
    projectName: string,
  ): Promise<ArchiveBaselineData | null> {
    return this.baselines.get(projectName) ?? null;
  }

  async setArchiveBaseline(
    projectName: string,
    baseline: ArchiveBaselineData,
  ): Promise<void> {
    this.baselines.set(projectName, baseline);
  }

  async getWatchState(projectName: string): Promise<WatchStateData> {
    return this.watches.get(projectName) ?? { etag: null, cursor: null };
  }

  async setWatchState(
    projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    this.watches.set(projectName, state);
  }

  async getTodoistProjectState(
    projectName: string,
  ): Promise<TodoistProjectStateData | null> {
    return this.todoistProjects.get(projectName) ?? null;
  }

  async setTodoistProjectState(
    projectName: string,
    state: TodoistProjectStateData,
  ): Promise<void> {
    this.todoistProjects.set(projectName, state);
  }
}
