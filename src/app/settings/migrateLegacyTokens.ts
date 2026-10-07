import {
  GITHUB_TOKEN_KEY,
  TODOIST_TOKEN_KEY,
  type SecretStore,
} from './SecretStorageAdapter.js';

// The legacy plaintext field in data.json and the secret id it migrates to.
const LEGACY_TOKEN_MIGRATIONS: ReadonlyArray<readonly [string, string]> = [
  ['githubToken', GITHUB_TOKEN_KEY],
  ['todoistToken', TODOIST_TOKEN_KEY],
];

// Moves the legacy plaintext tokens out of the data.json root and into the
// secret store, stripping the fields so they cannot round-trip. Returns true
// only when a non-empty token was migrated, so a profile that never set one is
// left untouched (no secret write, no save). Empty legacy fields are dropped
// from the in-memory root but do not force a write.
export function migrateLegacyTokens(
  data: Record<string, unknown>,
  secrets: SecretStore,
): boolean {
  let migrated = false;
  for (const [field, key] of LEGACY_TOKEN_MIGRATIONS) {
    const value = data[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      secrets.save(key, value.trim());
      migrated = true;
    }
    delete data[field];
  }
  return migrated;
}
