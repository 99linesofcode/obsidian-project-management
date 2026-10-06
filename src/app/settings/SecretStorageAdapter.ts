import type { SecretStorage } from 'obsidian';

// The secret ids the plugin owns. SecretStorage requires a lowercase
// alphanumeric id with optional dashes.
export const GITHUB_TOKEN_KEY = 'github-token';
export const TODOIST_TOKEN_KEY = 'todoist-token';

// The plugin's view of a secret store: one value per key, an absent value
// reported as null. The adapter below implements it against Obsidian's
// SecretStorage; the settings tab and the composition root depend on this
// shape, not on Obsidian.
export interface SecretStore {
  load(key: string): string | null;
  save(key: string, value: string): void;
  remove(key: string): void;
}

// Wraps Obsidian's SecretStorage. The typings expose setSecret/getSecret/
// listSecrets and no delete, so `remove` writes an empty value and `load`
// reports an empty value as absent — the cleared state.
export class SecretStorageAdapter implements SecretStore {
  constructor(private readonly storage: SecretStorage) {}

  load(key: string): string | null {
    const value = this.storage.getSecret(key);
    return value === null || value.length === 0 ? null : value;
  }

  save(key: string, value: string): void {
    this.storage.setSecret(key, value);
  }

  remove(key: string): void {
    this.storage.setSecret(key, '');
  }
}
