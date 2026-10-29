import type { SecretStore } from './secret-storage/SecretStorageAdapter.js';

export class TokenSettings {
  constructor(private readonly secrets: SecretStore) {}

  isStored(key: string): boolean {
    return this.secrets.load(key) !== null;
  }

  set(key: string, value: string): void {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    this.secrets.save(key, trimmed);
  }

  clear(key: string): void {
    this.secrets.remove(key);
  }
}
