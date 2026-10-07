import type { SecretStore } from './SecretStorageAdapter.js';

// The settings-facing token actions: status, set and clear, one per key. Split
// from the Obsidian Setting wiring so the behavior is testable without the
// host app. A blank value is never stored; clearing writes the empty state.
export class TokenSettings {
  constructor(private readonly secrets: SecretStore) {}

  isStored(key: string): boolean {
    return this.secrets.load(key) !== null;
  }

  load(key: string): string {
    return this.secrets.load(key) ?? '';
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
