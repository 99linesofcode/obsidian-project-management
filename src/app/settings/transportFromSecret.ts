import type { SecretStore } from './SecretStorageAdapter.js';

// Builds a provider transport from the token in the secret store. The factory
// is injected so the composition root passes the real transport builder and a
// test passes a fake that records the token it received. An absent secret
// becomes an empty token, so the transport is always constructible and a
// missing token surfaces as a failed request, not a crash.
export function transportFromSecret<T>(
  secrets: SecretStore,
  key: string,
  build: (token: string) => T,
): T {
  return build(secrets.load(key) ?? '');
}
