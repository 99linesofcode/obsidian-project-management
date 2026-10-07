import { describe, expect, it } from 'vitest';
import { GITHUB_TOKEN_KEY } from '../../../src/app/settings/SecretStorageAdapter.js';
import { transportFromSecret } from '../../../src/app/settings/transportFromSecret.js';
import { FakeSecretStore } from '../../helpers/fakeSecretStore.js';

describe('transportFromSecret', () => {
  it('hands the stored token to the transport factory', () => {
    const secrets = new FakeSecretStore({ [GITHUB_TOKEN_KEY]: 'ghp_stored' });
    const built: string[] = [];

    const transport = transportFromSecret(
      secrets,
      GITHUB_TOKEN_KEY,
      (token) => {
        built.push(token);
        return { kind: 'fake-transport' };
      },
    );

    expect(built).toEqual(['ghp_stored']);
    expect(transport).toEqual({ kind: 'fake-transport' });
  });

  it('hands an empty token when none is stored, so the transport still builds', () => {
    const built: string[] = [];

    transportFromSecret(new FakeSecretStore(), GITHUB_TOKEN_KEY, (token) => {
      built.push(token);
      return {};
    });

    expect(built).toEqual(['']);
  });
});
