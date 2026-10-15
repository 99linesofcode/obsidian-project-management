import { isRecord } from '../../core/domain/isRecord.js';

export async function loadDataSafely(
  read: () => Promise<unknown>,
  quarantine: () => Promise<void>,
  exists?: () => Promise<boolean>,
): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await read();
  } catch {
    await quarantine();
    return {};
  }
  if (raw === null || raw === undefined) {
    if (exists !== undefined && (await exists())) {
      await quarantine();
    }
    return {};
  }
  if (!isRecord(raw)) {
    await quarantine();
    return {};
  }
  return raw;
}
