import type { CanonicalField } from '../../core/canonicalField.js';
import { Baseline } from '../../core/data/Baseline.js';
import type { BaselineStorePort } from '../../core/ports/BaselineStorePort.js';

export interface CoreBaselineStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
}

const SYNC_STATE_KEY = 'syncState';
const CORE_BASELINES_KEY = 'coreBaselines';

export class CoreBaselineStoreAdapter implements BaselineStorePort {
  constructor(private readonly storage: CoreBaselineStorage) {}

  async read(
    entityId: string,
    field: CanonicalField,
    side: string,
  ): Promise<Baseline | null> {
    const data = await this.storage.load();
    const raw = baselinesOf(data)[entityId];
    const fieldNode = isRecord(raw) ? raw[field] : undefined;
    const entry = isRecord(fieldNode) ? fieldNode[side] : undefined;
    if (!isRecord(entry)) {
      return null;
    }
    return new Baseline(stringOrNull(entry.value), entry.completed === true);
  }

  async write(
    entityId: string,
    field: CanonicalField,
    side: string,
    baseline: Baseline,
  ): Promise<void> {
    const data = await this.storage.load();
    const entity = ensureRecord(baselinesOf(data), entityId);
    const fieldNode = ensureRecord(entity, field);
    fieldNode[side] = { value: baseline.value, completed: baseline.completed };
    await this.storage.save(data);
  }
}

function baselinesOf(data: Record<string, unknown>): Record<string, unknown> {
  const syncState = isRecord(data[SYNC_STATE_KEY]) ? data[SYNC_STATE_KEY] : {};
  if (!isRecord(data[SYNC_STATE_KEY])) {
    data[SYNC_STATE_KEY] = syncState;
  }
  if (!isRecord(syncState[CORE_BASELINES_KEY])) {
    syncState[CORE_BASELINES_KEY] = {};
  }
  return syncState[CORE_BASELINES_KEY] as Record<string, unknown>;
}

function ensureRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  if (!isRecord(parent[key])) {
    parent[key] = {};
  }
  return parent[key] as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
