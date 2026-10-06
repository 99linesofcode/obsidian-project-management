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

describe('the six seeded artifact paths round-trip', () => {
  const custom = {
    projectTemplatePath: 'Templates/MijnProject.md',
    taskTemplatePath: 'Templates/MijnTaken.md',
    todoTemplatePath: 'Templates/MijnTodos.md',
    projectsBasePath: 'Bases/MijnProjecten.base',
    tasksBasePath: 'Bases/MijnTaken.base',
    todosBasePath: 'Bases/MijnTodos.base',
  };

  it('defaults each path when data.json does not set it', () => {
    const settings = settingsFromData({});

    expect(settings.projectTemplatePath).toBe('Templates/Project.md');
    expect(settings.taskTemplatePath).toBe('Templates/Task.md');
    expect(settings.todoTemplatePath).toBe('Templates/ToDo.md');
    expect(settings.projectsBasePath).toBe('Bases/Projects.base');
    expect(settings.tasksBasePath).toBe('Bases/Tasks.base');
    expect(settings.todosBasePath).toBe('Bases/Todos.base');
  });

  it('loads every configured path from data.json', () => {
    const settings = settingsFromData(custom);

    for (const [key, value] of Object.entries(custom)) {
      expect(settings[key as keyof typeof custom]).toBe(value);
    }
  });

  it('persists every configured path on a settings save', () => {
    const settings = settingsFromData(custom);

    const merged = mergeSettingsIntoData({}, settings);

    for (const [key, value] of Object.entries(custom)) {
      expect(merged[key]).toBe(value);
    }
  });
});
