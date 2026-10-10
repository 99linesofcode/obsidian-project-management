import { Baseline } from '../../core/data/Baseline.js';
import type {
  BaselineField,
  BaselineStorePort,
} from '../../core/ports/BaselineStorePort.js';

export interface CoreBaselineStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
}

const CORE_BASELINES_KEY = 'coreBaselines';
const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

function readPath(
  data: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  let current: unknown = data;
  for (const key of keys) {
    if (!isRecord(current) || isForbiddenRecordKey(key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function ensureRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  if (isForbiddenRecordKey(key)) {
    throw new Error(`refusing forbidden baseline key: ${key}`);
  }
  if (!isRecord(parent[key])) {
    parent[key] = {};
  }
  return parent[key] as Record<string, unknown>;
}

function isForbiddenRecordKey(key: string): boolean {
  return FORBIDDEN_RECORD_KEYS.has(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
