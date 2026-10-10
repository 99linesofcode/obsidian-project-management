import type { SecretStorage } from 'obsidian';

export interface SecretStore {
  load(key: string): string | null;
  save(key: string, value: string): void;
  remove(key: string): void;
}

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
