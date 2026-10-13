import type { ProjectIdentityDataTransferObject } from '../../src/core/port/data/ProjectIdentityDataTransferObject.js';
import {
  projectFromNotePath,
  projectPathWithName,
} from '../../src/core/domain/paths.js';
import { Baseline } from '../../src/core/domain/Baseline.js';
import type { EntityRecord } from '../../src/core/port/data/EntityRecord.js';
import type { MirrorItem } from '../../src/core/port/data/MirrorItem.js';
import type { PortState } from '../../src/core/port/data/PortState.js';
import type { MergedField } from '../../src/core/domain/canonicalField.js';
import type { RegistryPort } from '../../src/core/port/RegistryPort.js';

interface SeededMirror {
  handle: string;
}

export interface TombstoneRecord {
  entityId: string;
  notePath: string;
  deletedAt: string;
  handle?: string;
}

function portKey(projectName: string, portId: string): string {
  return `${projectName}\u0000${portId}`;
}

export class FakeSyncState implements RegistryPort {
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
  identities = new Map<string, ProjectIdentityDataTransferObject>();
  identitiesBySlug = new Map<string, ProjectIdentityDataTransferObject>();
  setCalls: EntityRecord[] = [];
  removed: string[] = [];
  readonly recorded: Array<{
    project: string;
    connection: string;
    notePath: string;
    handle: string;
  }> = [];
  failOnRecord = 0;
  private recordCount = 0;
  portStateSets: Array<{
    projectName: string;
    portId: string;
    state: PortState;
  }> = [];
  tombstones = new Map<string, TombstoneRecord>();
  handleTombstones = new Map<string, TombstoneRecord>();
  failTombstoneWrites = 0;

  seed(record: EntityRecord, mirrors: Record<string, SeededMirror> = {}): void {
    this.records.set(record.id, record);
    for (const [portId, mirror] of Object.entries(mirrors)) {
      this.put(portId, mirror.handle, { entityId: record.id });
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
    for (const [notePath, record] of this.tombstones) {
      if (record.entityId === id) {
        this.tombstones.delete(notePath);
        if (record.handle !== undefined) {
          this.handleTombstones.delete(record.handle);
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

  async recordTombstone(record: TombstoneRecord): Promise<void> {
    if (this.failTombstoneWrites > 0) {
      this.failTombstoneWrites -= 1;
      throw new Error('tombstone write failed');
    }
    this.tombstones.set(record.notePath, record);
    if (record.handle !== undefined && record.handle !== '') {
      this.handleTombstones.set(record.handle, record);
    }
  }

  async findTombstoneByNotePath(
    notePath: string,
  ): Promise<TombstoneRecord | null> {
    return this.tombstones.get(notePath) ?? null;
  }

  async findTombstone(handle: string): Promise<TombstoneRecord | null> {
    return this.handleTombstones.get(handle) ?? null;
  }

  async listEntities(projectName: string): Promise<EntityRecord[]> {
    return [...this.records.values()].filter(
      (record) => projectFromNotePath(record.notePath) === projectName,
    );
  }

  async rekeyProject(fromProject: string, toProject: string): Promise<void> {
    if (fromProject === toProject) {
      return;
    }
    const fromPrefix = `${fromProject}\u0000`;
    const toPrefix = `${toProject}\u0000`;
    for (const [key, state] of [...this.portStates]) {
      if (key.startsWith(fromPrefix)) {
        this.portStates.delete(key);
        this.portStates.set(
          `${toPrefix}${key.slice(fromPrefix.length)}`,
          state,
        );
      }
    }
    for (const [key, identity] of [...this.identitiesBySlug]) {
      if (key.startsWith(fromPrefix)) {
        this.identitiesBySlug.delete(key);
        this.identitiesBySlug.set(
          `${toPrefix}${key.slice(fromPrefix.length)}`,
          identity,
        );
      }
    }
    const identity = this.identities.get(fromProject);
    if (identity !== undefined) {
      this.identities.delete(fromProject);
      this.identities.set(toProject, identity);
    }
    for (const [id, record] of [...this.records]) {
      if (projectFromNotePath(record.notePath) === fromProject) {
        this.records.set(id, {
          ...record,
          notePath: projectPathWithName(record.notePath, toProject),
        });
      }
    }
    const todoist = this.todoistProjects.get(fromProject);
    if (todoist !== undefined) {
      this.todoistProjects.delete(fromProject);
      this.todoistProjects.set(toProject, todoist);
    }
  }

  async hasProject(projectName: string): Promise<boolean> {
    const prefix = `${projectName}\u0000`;
    for (const key of this.portStates.keys()) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }
    for (const key of this.identitiesBySlug.keys()) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }
    if (this.identities.has(projectName)) {
      return true;
    }
    return [...this.records.values()].some(
      (record) => projectFromNotePath(record.notePath) === projectName,
    );
  }

  async listProjects(): Promise<string[]> {
    const names = new Set<string>();
    for (const key of this.portStates.keys()) {
      names.add(key.split('\u0000')[0]!);
    }
    for (const key of this.identitiesBySlug.keys()) {
      names.add(key.split('\u0000')[0]!);
    }
    for (const name of this.identities.keys()) {
      names.add(name);
    }
    for (const record of this.records.values()) {
      const name = projectFromNotePath(record.notePath);
      if (name !== '') {
        names.add(name);
      }
    }
    return [...names].sort();
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

  async resolveMirrorHandle(
    connection: string,
    notePath: string,
  ): Promise<string | null> {
    const entity = await this.findByNotePath(notePath);
    if (entity === null) {
      return null;
    }
    const item = await this.findMirrorItemByEntity(connection, entity.id);
    return item?.handle ?? null;
  }

  async listMirrorHandles(
    project: string,
    connection: string,
  ): Promise<readonly { handle: string; notePath: string }[]> {
    const items = await this.listMirrorItems(project, connection);
    const resolved: Array<{ handle: string; notePath: string }> = [];
    for (const { handle, item } of items) {
      const entity = await this.getEntity(item.entityId);
      if (entity !== null) {
        resolved.push({ handle, notePath: entity.notePath });
      }
    }
    return resolved;
  }

  async recordMirrorHandle(
    project: string,
    connection: string,
    notePath: string,
    handle: string,
  ): Promise<void> {
    this.recordCount += 1;
    if (this.recordCount === this.failOnRecord) {
      throw new Error('registry write failed');
    }
    this.recorded.push({ project, connection, notePath, handle });
    const entity = await this.findByNotePath(notePath);
    const entityId = entity?.id ?? crypto.randomUUID();
    if (entity === null) {
      await this.setEntity({ id: entityId, notePath });
    }
    const existing = await this.findMirrorItemByEntity(connection, entityId);
    if (existing !== null && existing.handle !== handle) {
      await this.removeMirrorItem(project, connection, existing.handle);
    }
    await this.setMirrorItem(project, connection, handle, { entityId });
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

  async resolveMirrorProject(
    project: string,
    connection: string,
  ): Promise<string | null> {
    const state = await this.getPortState(project, connection);
    return state === null || state.project === '' ? null : state.project;
  }

  async recordMirrorProject(
    project: string,
    connection: string,
    application: string,
    handle: string,
  ): Promise<void> {
    const state = await this.getPortState(project, connection);
    await this.setPortState(project, connection, {
      provider: state?.provider ?? application,
      project: handle,
      lastPoll: state?.lastPoll ?? null,
      lanes: state?.lanes ?? {},
    });
  }

  async setIdentity(
    projectName: string,
    connectionSlug: string,
    identity: ProjectIdentityDataTransferObject,
  ): Promise<void> {
    this.identitiesBySlug.set(portKey(projectName, connectionSlug), identity);
    this.identities.set(projectName, identity);
  }

  async getIdentity(
    projectName: string,
    connectionSlug: string,
  ): Promise<ProjectIdentityDataTransferObject | null> {
    return (
      this.identitiesBySlug.get(portKey(projectName, connectionSlug)) ??
      this.identities.get(projectName) ??
      null
    );
  }

  private readonly baselines = new Map<string, Baseline>();

  async readBaseline(
    entityId: string,
    field: MergedField,
    side: string,
  ): Promise<Baseline | null> {
    return this.baselines.get(`${entityId}\u0000${field}\u0000${side}`) ?? null;
  }

  async writeBaseline(
    entityId: string,
    field: MergedField,
    side: string,
    baseline: Baseline,
  ): Promise<void> {
    this.baselines.set(`${entityId}\u0000${field}\u0000${side}`, baseline);
  }
}
