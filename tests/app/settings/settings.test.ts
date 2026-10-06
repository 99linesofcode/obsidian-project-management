import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  mergeSettingsIntoData,
  settingsFromData,
  type ProjectManagementSettings,
} from '../../../src/app/settings/settings.js';

describe('REG-3 — a settings save never reverts the registry', () => {
  it('strips the registry container out of the loaded settings', () => {
    const data = {
      githubToken: 'ghp_x',
      syncState: { version: 3, projects: { A: {} } },
    };


    const settings = settingsFromData(data);
    expect(settings).not.toHaveProperty('syncState');
    expect(settings.githubToken).toBe('ghp_x');
    expect(settings.pollIntervalMinutes).toBe(
      DEFAULT_SETTINGS.pollIntervalMinutes,
    );
  });

  it('preserves registry writes made after onload when settings are saved', () => {
    const onloadData = {
      githubToken: 'old',
      syncState: { version: 3, projects: { A: {} } },
    };
    const settings = settingsFromData(onloadData);

    settings.githubToken = 'new';

    const currentData = {
      githubToken: 'old',
      syncState: { version: 3, projects: { A: {}, B: {} } },
    };

    const merged = mergeSettingsIntoData(currentData, settings);

    expect(merged.syncState).toEqual({
      version: 3,
      projects: { A: {}, B: {} },
    });
    expect(merged.githubToken).toBe('new');
  });

  it('never lets a stale settings snapshot shadow the registry', () => {
    const settings: ProjectManagementSettings & { syncState?: unknown } = {
      ...DEFAULT_SETTINGS,
      syncState: { version: 3, projects: { stale: {} } },
    };
    const currentData = {
      syncState: { version: 3, projects: { fresh: {} } },
    };

    const merged = mergeSettingsIntoData(currentData, settings);

    expect(merged.syncState).toEqual({ version: 3, projects: { fresh: {} } });
  });
});
