import type { SecretStore } from '../../src/app/settings/SecretStorageAdapter.js';

// An in-memory SecretStore for tests: the same load/save/remove contract the
// adapter implements, with a seed for the Given. An empty value reads as
// absent, matching the adapter's cleared state.
export class FakeSecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) {
      this.values.set(key, value);
    }
  }

  load(key: string): string | null {
    const value = this.values.get(key);
    return value === undefined || value.length === 0 ? null : value;
  }

  save(key: string, value: string): void {
    this.values.set(key, value);
  }

  remove(key: string): void {
    this.values.delete(key);
  }
}
