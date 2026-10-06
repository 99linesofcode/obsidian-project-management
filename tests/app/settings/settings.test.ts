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
      syncState: { version: 3, projects: { A: {} } },
    };

    const settings = settingsFromData(data);
    expect(settings).not.toHaveProperty('syncState');
    expect(settings.pollIntervalMinutes).toBe(
      DEFAULT_SETTINGS.pollIntervalMinutes,
    );
  });

  it('preserves registry writes made after onload when settings are saved', () => {
    const onloadData = {
      syncState: { version: 3, projects: { A: {} } },
    };
    const settings = settingsFromData(onloadData);

    settings.pollIntervalMinutes = 10;

    const currentData = {
      syncState: { version: 3, projects: { A: {}, B: {} } },
    };

    const merged = mergeSettingsIntoData(currentData, settings);

    expect(merged.syncState).toEqual({
      version: 3,
      projects: { A: {}, B: {} },
    });
    expect(merged.pollIntervalMinutes).toBe(10);
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

describe('settings are secret-free', () => {
  it('does not carry token fields', () => {
    expect(DEFAULT_SETTINGS).not.toHaveProperty('githubToken');
    expect(DEFAULT_SETTINGS).not.toHaveProperty('todoistToken');
  });

  it('drops legacy token fields from the loaded settings', () => {
    const settings = settingsFromData({
      githubToken: 'ghp_x',
      todoistToken: 'td_y',
    });

    expect(settings).not.toHaveProperty('githubToken');
    expect(settings).not.toHaveProperty('todoistToken');
  });

  it('never writes legacy token fields back into data.json', () => {
    const settings = settingsFromData({ githubToken: 'ghp_x' });

    const merged = mergeSettingsIntoData(
      { githubToken: 'ghp_x', todoistToken: 'td_y' },
      settings,
    );

    expect(merged).not.toHaveProperty('githubToken');
    expect(merged).not.toHaveProperty('todoistToken');
  });
});
