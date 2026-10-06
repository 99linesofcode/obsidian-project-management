import { describe, expect, it } from 'vitest';
import {
  GITHUB_TOKEN_KEY,
  TODOIST_TOKEN_KEY,
} from '../../../src/app/settings/SecretStorageAdapter.js';
import { TokenSettings } from '../../../src/app/settings/TokenSettings.js';
import { FakeSecretStore } from '../../helpers/fakeSecretStore.js';

describe('TokenSettings', () => {
  it('reports a stored token', () => {
    const tokens = new TokenSettings(
      new FakeSecretStore({ [GITHUB_TOKEN_KEY]: 'ghp_x' }),
    );

    expect(tokens.isStored(GITHUB_TOKEN_KEY)).toBe(true);
  });

  it('reports an unset token', () => {
    const tokens = new TokenSettings(new FakeSecretStore());

    expect(tokens.isStored(GITHUB_TOKEN_KEY)).toBe(false);
  });

  it('stores a trimmed token', () => {
    const secrets = new FakeSecretStore();

    new TokenSettings(secrets).set(GITHUB_TOKEN_KEY, '  ghp_x  ');

    expect(secrets.load(GITHUB_TOKEN_KEY)).toBe('ghp_x');
  });

  it('never stores a blank token', () => {
    const secrets = new FakeSecretStore();

    new TokenSettings(secrets).set(GITHUB_TOKEN_KEY, '   ');

    expect(secrets.load(GITHUB_TOKEN_KEY)).toBeNull();
  });

  it('clearing a token removes it from the secret store', () => {
    const secrets = new FakeSecretStore({ [GITHUB_TOKEN_KEY]: 'ghp_x' });

    new TokenSettings(secrets).clear(GITHUB_TOKEN_KEY);

    expect(secrets.load(GITHUB_TOKEN_KEY)).toBeNull();
  });

  it('loads a stored token, empty when unset', () => {
    const stored = new TokenSettings(
      new FakeSecretStore({ [TODOIST_TOKEN_KEY]: 'td_y' }),
    );

    expect(stored.load(TODOIST_TOKEN_KEY)).toBe('td_y');
    expect(
      new TokenSettings(new FakeSecretStore()).load(TODOIST_TOKEN_KEY),
    ).toBe('');
  });
});
