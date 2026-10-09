import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  PluginSettingTab: class {
    constructor(
      public app: unknown,
      public plugin: unknown,
    ) {}
    display(): void {}
    update(): void {}
  },
  Setting: class {},
}));

import type { App } from 'obsidian';
import type ProjectManagementPlugin from '../../../src/main.js';
import { ProjectManagementSettingTab } from '../../../src/app/settings/PluginSettingTab.js';
import { DEFAULT_SETTINGS } from '../../../src/app/settings/settings.js';

function buildTab(): ProjectManagementSettingTab {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    secrets: { load: () => null, save: () => {}, remove: () => {} },
  } as unknown as ProjectManagementPlugin;

  return new ProjectManagementSettingTab({} as App, plugin);
}

describe('ProjectManagementSettingTab', () => {
  it('declares its settings through getSettingDefinitions', () => {
    const names = buildTab()
      .getSettingDefinitions()
      .map((item) => (item as { name: string }).name);

    expect(names).toContain('GitHub token');
    expect(names).toContain('Todoist token');
    expect(names).toContain('Poll interval (minutes)');
  });

  it('renders from the declarative definitions, not the deprecated display override', () => {
    const overridesDisplay = Object.prototype.hasOwnProperty.call(
      ProjectManagementSettingTab.prototype,
      'display',
    );

    expect(overridesDisplay).toBe(false);
  });
});
