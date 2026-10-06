import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  mergeSettingsIntoData,
  settingsFromData,
  type ProjectManagementSettings,
} from '../../../src/app/settings/settings.js';

describe('settings persistence', () => {
  it('strips the registry container out of the loaded settings', () => {
    // Given — a data.json root holding both settings and the registry
    const data = {
      githubToken: 'ghp_x',
      syncState: { version: 3, projects: { A: {} } },
    };

    // When — settings are built from the root

    // Then — the registry never leaks into settings
    const settings = settingsFromData(data);
    expect(settings).not.toHaveProperty('syncState');
    expect(settings.githubToken).toBe('ghp_x');
    expect(settings.pollIntervalMinutes).toBe(
      DEFAULT_SETTINGS.pollIntervalMinutes,
    );
  });

  it('preserves registry writes made after onload when settings are saved', () => {
    // Given — onload read a registry that already held project A
    const onloadData = {
      githubToken: 'old',
      syncState: { version: 3, projects: { A: {} } },
    };
    const settings = settingsFromData(onloadData);

    // And — the user edits a setting after onload
    settings.githubToken = 'new';

    // And — a sync pass writes project B to the registry after onload
    const currentData = {
      githubToken: 'old',
      syncState: { version: 3, projects: { A: {}, B: {} } },
    };

    // When — settings are saved against a fresh read
    const merged = mergeSettingsIntoData(currentData, settings);

    // Then — the registry write survives and the setting lands
    expect(merged.syncState).toEqual({
      version: 3,
      projects: { A: {}, B: {} },
    });
    expect(merged.githubToken).toBe('new');
  });

  it('never lets a stale settings snapshot shadow the registry', () => {
    // Given — settings that somehow still carry a registry snapshot
    const settings: ProjectManagementSettings & { syncState?: unknown } = {
      ...DEFAULT_SETTINGS,
      syncState: { version: 3, projects: { stale: {} } },
    };
    const currentData = {
      syncState: { version: 3, projects: { fresh: {} } },
    };

    // When — they are merged into a fresh read
    const merged = mergeSettingsIntoData(currentData, settings);

    // Then — the fresh registry wins
    expect(merged.syncState).toEqual({ version: 3, projects: { fresh: {} } });
  });
});
