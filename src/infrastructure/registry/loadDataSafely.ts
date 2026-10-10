import { isRecord } from '../../domain/isRecord.js';
// Reads the data.json root so that a missing or unreadable file can never wipe
// the registry. A missing file yields {} — there is nothing to lose. A file
// that exists but cannot be read or parsed is QUARANTINED (moved aside by the
// caller) before we start empty, so every byte survives for manual recovery.
// WHY quarantine over silently starting empty: the registry is the one file the
// plugin cannot afford to lose, and overwriting a corrupt file would destroy
// whatever a person might still recover. WHY quarantine over throwing: a thrown
// load leaves the whole plugin unusable, while a rename lets it run and keeps
// the bytes. The quarantine callback is awaited, so a failed rename propagates
// and the corrupt file is never overwritten.
//
// `exists` disambiguates a null read: Obsidian can return null both for a file
// that is not there (nothing to lose) and for a parse failure (a corrupt file
// that must not be reset). Only the existence probe can tell them apart.
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
