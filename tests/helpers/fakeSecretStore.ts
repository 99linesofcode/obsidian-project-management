import type { SecretStore } from '../../src/ui/settings/secret-storage/SecretStorageAdapter.js';

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
