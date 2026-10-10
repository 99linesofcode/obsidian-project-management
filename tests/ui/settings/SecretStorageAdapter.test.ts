import { describe, expect, it } from 'vitest';
import type { SecretStorage } from 'obsidian';
import { SecretStorageAdapter } from '../../../src/ui/settings/secret-storage/SecretStorageAdapter.js';

const GITHUB_TOKEN_KEY = 'github-token';

class FakeObsidianSecretStorage {
  private readonly values = new Map<string, string>();

  setSecret(id: string, secret: string): void {
    this.values.set(id, secret);
  }

  getSecret(id: string): string | null {
    return this.values.get(id) ?? null;
  }

  listSecrets(): string[] {
    return [...this.values.keys()];
  }
}

function adapter(): SecretStorageAdapter {
  return new SecretStorageAdapter(
    new FakeObsidianSecretStorage() as unknown as SecretStorage,
  );
}

describe('SecretStorageAdapter', () => {
  it('saves a secret and loads it back', () => {
    const store = adapter();

    store.save(GITHUB_TOKEN_KEY, 'ghp_x');

    expect(store.load(GITHUB_TOKEN_KEY)).toBe('ghp_x');
  });

  it('reports an absent secret as null', () => {
    expect(adapter().load(GITHUB_TOKEN_KEY)).toBeNull();
  });

  it('clears a secret so it reads as absent', () => {
    const store = adapter();
    store.save(GITHUB_TOKEN_KEY, 'ghp_x');

    store.remove(GITHUB_TOKEN_KEY);

    expect(store.load(GITHUB_TOKEN_KEY)).toBeNull();
  });
});
