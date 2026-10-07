import type { SecretStore } from './SecretStorageAdapter.js';

export function transportFromSecret<T>(
  secrets: SecretStore,
  key: string,
  build: (token: string) => T,
): T {
  return build(secrets.load(key) ?? '');
}
