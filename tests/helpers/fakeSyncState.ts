import type { ArchiveBaselineData } from '../../src/shared/ArchiveBaselineData.js';
import type { ProjectIdentityData } from '../../src/shared/ProjectIdentityData.js';
import type { TaskData } from '../../src/shared/TaskData.js';
import type { WatchStateData } from '../../src/shared/WatchStateData.js';
import { projectFromNotePath } from '../../src/projects/projectFromNotePath.js';
import type {
  EntityRecord,
  MirrorItem,
  PortState,
  SyncStatePort,
} from '../../src/shared/SyncStatePort.js';

interface SeededMirror {
  handle: string;
  base?: TaskData | null;
}

function portKey(projectName: string, portId: string): string {
  return `${projectName}\u0000${portId}`;
}

export class FakeSyncState implements SyncStatePort {
  records = new Map<string, EntityRecord>();
  items = new Map<string, Map<string, MirrorItem>>();
  portStates = new Map<string, PortState>();
  todoistProjects = new Map<
    string,
    { sections: Record<string, string>; lastCompletedPoll: string }
  >();
  todoistSets: Array<{
    projectName: string;
    state: { sections: Record<string, string>; lastCompletedPoll: string };
  }> = [];
  identities = new Map<string, ProjectIdentityData>();
  identitiesBySlug = new Map<string, ProjectIdentityData>();
  lastUpdates = new Map<string, string>();
  baselines = new Map<string, ArchiveBaselineData>();
  watches = new Map<string, WatchStateData>();
  setCalls: EntityRecord[] = [];
  removed: string[] = [];
  baselineSets: Array<{ projectName: string; baseline: ArchiveBaselineData }> =
    [];
  watchSets: Array<{ projectName: string; state: WatchStateData }> = [];
  portStateSets: Array<{
    projectName: string;
    portId: string;
    state: PortState;
  }> = [];
  lastUpdateSets: Array<{ projectName: string; iso: string }> = [];
  fullScanPending = new Set<string>();
  fullScanConsumes: Array<{ project: string; pending: boolean }> = [];

  seed(record: EntityRecord, mirrors: Record<string, SeededMirror> = {}): void {
    this.records.set(record.id, record);
    for (const [portId, mirror] of Object.entries(mirrors)) {
      this.put(portId, mirror.handle, {
        entityId: record.id,
        base: mirror.base ?? null,
      });
    }
  }

  handleOf(entityId: string, portId: string): string | null {
    for (const [handle, item] of this.items.get(portId) ?? []) {
      if (item.entityId === entityId) {
        return handle;
      }
    }
    return null;
  }

  baseOf(entityId: string, portId: string): TaskData | null {
    const handle = this.handleOf(entityId, portId);
    return handle === null
      ? null
      : (this.items.get(portId)?.get(handle)?.base ?? null);
  }

  mirrorsOf(entityId: string): string[] {
    const result: string[] = [];
    for (const [portId, handles] of this.items) {
      for (const item of handles.values()) {
        if (item.entityId === entityId) {
          result.push(portId);
          break;
        }
      }
    }
    return result;
  }

  private put(portId: string, handle: string, item: MirrorItem): void {
    let handles = this.items.get(portId);
    if (handles === undefined) {
      handles = new Map();
      this.items.set(portId, handles);
    }
    handles.set(handle, item);
  }

  private dropRecord(id: string): void {
    this.records.delete(id);
    for (const handles of this.items.values()) {
      for (const [handle, item] of handles) {
        if (item.entityId === id) {
          handles.delete(handle);
        }
      }
    }
  }

  async getEntity(id: string): Promise<EntityRecord | null> {
    return this.records.get(id) ?? null;
  }

  async get(id: string): Promise<EntityRecord | null> {
    return this.getEntity(id);
  }

  async list(): Promise<EntityRecord[]> {
    return [...this.records.values()];
  }

  async findByMirror(
    provider: string,
    handle: string,
  ): Promise<EntityRecord | null> {
    const item = this.items.get(provider)?.get(handle);
    return item === undefined
      ? null
      : (this.records.get(item.entityId) ?? null);
  }

  async findByNotePath(notePath: string): Promise<EntityRecord | null> {
    for (const record of this.records.values()) {
      if (record.notePath === notePath) {
        return record;
      }
    }
    return null;
  }

  async setEntity(record: EntityRecord): Promise<void> {
    for (const [id, other] of this.records) {
      if (id !== record.id && other.notePath === record.notePath) {
        this.dropRecord(id);
      }
    }
    this.records.set(record.id, record);
    this.setCalls.push(record);
  }

  async removeEntity(id: string): Promise<void> {
    this.dropRecord(id);
    this.removed.push(id);
  }

  async listEntities(projectName: string): Promise<EntityRecord[]> {
    return [...this.records.values()].filter(
      (record) => projectFromNotePath(record.notePath) === projectName,
    );
  }

  async findMirrorItem(
    portId: string,
    handle: string,
  ): Promise<MirrorItem | null> {
    return this.items.get(portId)?.get(handle) ?? null;
  }

  async findMirrorItemByEntity(
    portId: string,
    entityId: string,
  ): Promise<{ handle: string; item: MirrorItem } | null> {
    const handle = this.handleOf(entityId, portId);
    if (handle === null) {
      return null;
    }
    const item = this.items.get(portId)?.get(handle);
    return item === undefined ? null : { handle, item };
  }

  async setMirrorItem(
    _projectName: string,
    portId: string,
    handle: string,
    item: MirrorItem,
  ): Promise<void> {
    this.put(portId, handle, item);
  }

  async removeMirrorItem(
    _projectName: string,
    portId: string,
    handle: string,
  ): Promise<void> {
    this.items.get(portId)?.delete(handle);
  }

  async listMirrorItems(
    projectName: string,
    portId: string,
  ): Promise<Array<{ handle: string; item: MirrorItem }>> {
    const result: Array<{ handle: string; item: MirrorItem }> = [];
    for (const [handle, item] of this.items.get(portId) ?? []) {
      const record = this.records.get(item.entityId);
      if (
        record === undefined ||
        projectFromNotePath(record.notePath) === projectName
      ) {
        result.push({ handle, item });
      }
    }
    return result;
  }

  async getPortState(
    projectName: string,
    portId: string,
  ): Promise<PortState | null> {
    const state = this.portStates.get(portKey(projectName, portId));
    if (state !== undefined) {
      return state;
    }
    if (portId !== 'todoist') {
      return null;
    }
    const legacy = this.todoistProjects.get(projectName);
    return legacy === undefined
      ? null
      : {
          provider: 'todoist',
          project: '',
          lastPoll: legacy.lastCompletedPoll,
          lanes: legacy.sections,
        };
  }

  async setPortState(
    projectName: string,
    portId: string,
    state: PortState,
  ): Promise<void> {
    this.portStates.set(portKey(projectName, portId), state);
    if (portId === 'todoist') {
      const legacy = {
        sections: state.lanes,
        lastCompletedPoll: state.lastPoll ?? '',
      };
      this.todoistProjects.set(projectName, legacy);
      this.todoistSets.push({ projectName, state: legacy });
    }
    this.portStateSets.push({ projectName, portId, state });
  }

  async listPortStates(
    projectName: string,
  ): Promise<Array<{ slug: string; state: PortState }>> {
    const prefix = `${projectName}\u0000`;
    const result: Array<{ slug: string; state: PortState }> = [];
    for (const [key, state] of this.portStates) {
      if (key.startsWith(prefix)) {
        result.push({ slug: key.slice(prefix.length), state });
      }
    }
    return result;
  }

  async rekeyPortState(
    projectName: string,
    fromSlug: string,
    toSlug: string,
  ): Promise<void> {
    if (fromSlug === toSlug) {
      return;
    }
    const state = this.portStates.get(portKey(projectName, fromSlug));
    if (state === undefined) {
      return;
    }
    this.portStates.delete(portKey(projectName, fromSlug));
    this.portStates.set(portKey(projectName, toSlug), state);
    if (fromSlug === 'todoist') {
      this.todoistProjects.delete(projectName);
    }
    const items = this.items.get(fromSlug);
    if (items !== undefined) {
      this.items.delete(fromSlug);
      this.items.set(toSlug, items);
    }
  }

  async setIdentity(
    projectName: string,
    connectionSlug: string,
    identity: ProjectIdentityData,
  ): Promise<void> {
    this.identitiesBySlug.set(portKey(projectName, connectionSlug), identity);
    this.identities.set(projectName, identity);
  }

  async getIdentity(
    projectName: string,
    connectionSlug: string,
  ): Promise<ProjectIdentityData | null> {
    return (
      this.identitiesBySlug.get(portKey(projectName, connectionSlug)) ??
      this.identities.get(projectName) ??
      null
    );
  }

  async listIdentities(
    projectName: string,
  ): Promise<Array<{ slug: string; identity: ProjectIdentityData }>> {
    const result: Array<{ slug: string; identity: ProjectIdentityData }> = [];
    const prefix = `${projectName}\u0000`;
    for (const [key, identity] of this.identitiesBySlug) {
      if (key.startsWith(prefix)) {
        result.push({ slug: key.slice(prefix.length), identity });
      }
    }
    if (result.length === 0) {
      const identity = this.identities.get(projectName);
      if (identity !== undefined) {
        result.push({ slug: 'github', identity });
      }
    }
    return result;
  }

  async getLastProjectUpdate(projectName: string): Promise<string | null> {
    return this.lastUpdates.get(projectName) ?? null;
  }

  async setLastProjectUpdate(projectName: string, iso: string): Promise<void> {
    this.lastUpdates.set(projectName, iso);
    this.lastUpdateSets.push({ projectName, iso });
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
    this.baselineSets.push({ projectName, baseline });
  }

  async getWatchState(projectName: string): Promise<WatchStateData> {
    return this.watches.get(projectName) ?? { etag: null, cursor: null };
  }

  async setWatchState(
    projectName: string,
    state: WatchStateData,
  ): Promise<void> {
    this.watches.set(projectName, state);
    this.watchSets.push({ projectName, state });
  }

  async isFullScanPending(projectName: string): Promise<boolean> {
    return this.fullScanPending.has(projectName);
  }

  async consumeFullScan(projectName: string): Promise<boolean> {
    const pending = this.fullScanPending.delete(projectName);
    this.fullScanConsumes.push({ project: projectName, pending });
    return pending;
  }

  projectCursors = new Map<string, string>();
  cursorSets: Array<{ portId: string; iso: string }> = [];

  async getProjectCursor(portId: string): Promise<string | null> {
    return this.projectCursors.get(portId) ?? null;
  }

  async setProjectCursor(portId: string, iso: string): Promise<void> {
    this.projectCursors.set(portId, iso);
    this.cursorSets.push({ portId, iso });
  }
}
