import { describe, expect, it } from 'vitest';
import { transportFromSecret } from '../../../src/ui/settings/secret-storage/transportFromSecret.js';
import { FakeSecretStore } from '../../helpers/fakeSecretStore.js';

const GITHUB_TOKEN_KEY = 'github-token';

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
