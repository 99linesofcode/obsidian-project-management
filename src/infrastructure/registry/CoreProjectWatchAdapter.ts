import type {
  ProjectWatchPort,
  ProjectWatchState,
} from '../../core/port/ProjectWatchPort.js';
import {
  ensureRecord,
  isRecord,
  readPath,
  stringOrNull,
} from './coreStorageRecord.js';

export interface CoreWatchStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
}

const CORE_WATCHES_KEY = 'coreWatches';

export class CoreProjectWatchAdapter implements ProjectWatchPort {
  constructor(private readonly storage: CoreWatchStorage) {}

  async read(project: string, connection: string): Promise<ProjectWatchState> {
    const data = await this.storage.load();
    const entry = readPath(data, [CORE_WATCHES_KEY, project, connection]);
    if (!isRecord(entry)) {
      return { etag: null, cursor: null };
    }
    return {
      etag: stringOrNull(entry.etag),
      cursor: stringOrNull(entry.cursor),
    };
  }

  async write(
    project: string,
    connection: string,
    state: ProjectWatchState,
  ): Promise<void> {
    const data = await this.storage.load();
    const watches = ensureRecord(data, CORE_WATCHES_KEY);
    const projectNode = ensureRecord(watches, project);
    projectNode[connection] = { etag: state.etag, cursor: state.cursor };
    await this.storage.save(data);
  }
}
