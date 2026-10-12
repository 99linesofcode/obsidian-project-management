import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  mergeSettingsIntoData,
  settingsFromData,
} from '../../../src/ui/settings/settings.js';
import type { ProjectManagementSettings } from '../../../src/core/application/data/ProjectManagementSettings.js';

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
});

describe('the board scaffolding vocabulary round-trips', () => {
  it('defaults the status vocabulary', () => {
    const settings = settingsFromData({});

    expect(settings.statusOptions).toEqual([
      'Unshaped',
      'Shaping',
      'Shaped',
      'Building',
      'Shipped',
    ]);
  });

  it('loads and persists the configured vocabulary', () => {
    const settings = settingsFromData({
      statusOptions: ['Todo', 'Doing', 'Done'],
    });

    expect(settings.statusOptions).toEqual(['Todo', 'Doing', 'Done']);

    const merged = mergeSettingsIntoData({}, settings);
    expect(merged.statusOptions).toEqual(['Todo', 'Doing', 'Done']);
  });

  it('clones the default lists so a caller cannot mutate them', () => {
    const settings = settingsFromData({});

    settings.statusOptions.push('Extra');

    expect(DEFAULT_SETTINGS.statusOptions).not.toContain('Extra');
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
