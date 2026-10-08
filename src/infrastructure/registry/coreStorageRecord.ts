const FORBIDDEN_RECORD_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export function readPath(
  data: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  let current: unknown = data;
  for (const key of keys) {
    if (!isRecord(current) || FORBIDDEN_RECORD_KEYS.has(key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

export function ensureRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  if (FORBIDDEN_RECORD_KEYS.has(key)) {
    throw new Error(`refusing forbidden storage key: ${key}`);
  }
  if (!isRecord(parent[key])) {
    parent[key] = {};
  }
  return parent[key] as Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
