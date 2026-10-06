import { describe, expect, it } from 'vitest';
import {
  GITHUB_TOKEN_KEY,
  TODOIST_TOKEN_KEY,
} from '../../../src/app/settings/SecretStorageAdapter.js';
import { migrateLegacyTokens } from '../../../src/app/settings/migrateLegacyTokens.js';
import {
  mergeSettingsIntoData,
  settingsFromData,
} from '../../../src/app/settings/settings.js';
import { FakeSecretStore } from '../../helpers/fakeSecretStore.js';

describe('migrateLegacyTokens', () => {
  it('moves a legacy token into the secret store and strips the field', () => {
    const secrets = new FakeSecretStore();
    const data: Record<string, unknown> = {
      githubToken: 'ghp_x',
      todoistToken: 'td_y',
      pollIntervalMinutes: 5,
    };

    const migrated = migrateLegacyTokens(data, secrets);

    expect(migrated).toBe(true);
    expect(secrets.load(GITHUB_TOKEN_KEY)).toBe('ghp_x');
    expect(secrets.load(TODOIST_TOKEN_KEY)).toBe('td_y');
    expect(data).not.toHaveProperty('githubToken');
    expect(data).not.toHaveProperty('todoistToken');
    expect(data.pollIntervalMinutes).toBe(5);
  });

  it('is silent when no legacy token is present', () => {
    const secrets = new FakeSecretStore();
    const data: Record<string, unknown> = { pollIntervalMinutes: 5 };

    const migrated = migrateLegacyTokens(data, secrets);

    expect(migrated).toBe(false);
    expect(secrets.load(GITHUB_TOKEN_KEY)).toBeNull();
    expect(secrets.load(TODOIST_TOKEN_KEY)).toBeNull();
  });

  it('strips an empty legacy field without writing a secret', () => {
    const secrets = new FakeSecretStore();
    const data: Record<string, unknown> = { githubToken: '' };

    const migrated = migrateLegacyTokens(data, secrets);

    expect(migrated).toBe(false);
    expect(secrets.load(GITHUB_TOKEN_KEY)).toBeNull();
    expect(data).not.toHaveProperty('githubToken');
  });

  it('does not duplicate: the field is gone after migration', () => {
    const secrets = new FakeSecretStore();
    const data: Record<string, unknown> = { githubToken: 'ghp_x' };

    migrateLegacyTokens(data, secrets);

    expect(data).not.toHaveProperty('githubToken');
    expect(secrets.load(GITHUB_TOKEN_KEY)).toBe('ghp_x');
  });

  it('leaves no token material in the persisted root after migration', () => {
    const secrets = new FakeSecretStore();
    const raw: Record<string, unknown> = {
      githubToken: 'ghp_x',
      todoistToken: 'td_y',
      syncState: { version: 3 },
    };

    migrateLegacyTokens(raw, secrets);
    const persisted = mergeSettingsIntoData(raw, settingsFromData(raw));

    expect(JSON.stringify(persisted)).not.toContain('ghp_x');
    expect(JSON.stringify(persisted)).not.toContain('td_y');
    expect(persisted).not.toHaveProperty('githubToken');
    expect(persisted).not.toHaveProperty('todoistToken');
  });

  it('leaves a fresh profile free of token fields', () => {
    const secrets = new FakeSecretStore();
    const raw: Record<string, unknown> = {};

    const migrated = migrateLegacyTokens(raw, secrets);
    const persisted = mergeSettingsIntoData(raw, settingsFromData(raw));

    expect(migrated).toBe(false);
    expect(persisted).not.toHaveProperty('githubToken');
    expect(persisted).not.toHaveProperty('todoistToken');
  });
});
