import { Baseline } from '../../core/application/data/Baseline.js';
import type {
  BaselineField,
  BaselineStorePort,
} from '../../core/port/BaselineStorePort.js';
import {
  ensureRecord,
  isRecord,
  readPath,
  stringOrNull,
} from './coreStorageRecord.js';

export interface CoreBaselineStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
}

const CORE_BASELINES_KEY = 'coreBaselines';

export class CoreBaselineStoreAdapter implements BaselineStorePort {
  constructor(private readonly storage: CoreBaselineStorage) {}

  async read(
    entityId: string,
    field: BaselineField,
    side: string,
  ): Promise<Baseline | null> {
    const data = await this.storage.load();
    const entry = readPath(data, [CORE_BASELINES_KEY, entityId, field, side]);
    if (!isRecord(entry)) {
      return null;
    }
    return new Baseline(stringOrNull(entry.value), entry.completed === true);
  }

  async write(
    entityId: string,
    field: BaselineField,
    side: string,
    baseline: Baseline,
  ): Promise<void> {
    const data = await this.storage.load();
    const baselines = ensureRecord(data, CORE_BASELINES_KEY);
    const entity = ensureRecord(baselines, entityId);
    const fieldNode = ensureRecord(entity, field);
    fieldNode[side] = { value: baseline.value, completed: baseline.completed };
    await this.storage.save(data);
  }
}
