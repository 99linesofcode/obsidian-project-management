// A plain-object guard for untrusted transport payloads: an object that is
// neither null nor an array. Shared by every adapter that walks a provider's
// JSON.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
