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
import { ProjectManagementSettingTab } from '../../../src/ui/settings/ProjectManagementSettingTab.js';
import { DEFAULT_SETTINGS } from '../../../src/ui/settings/settings.js';
import { githubDescriptor } from '../../../src/infrastructure/github/githubDescriptor.js';
import { todoistDescriptor } from '../../../src/infrastructure/todoist/todoistDescriptor.js';

function buildTab(): ProjectManagementSettingTab {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    secrets: { load: () => null, save: () => {}, remove: () => {} },
    providerDescriptors: [githubDescriptor(), todoistDescriptor()],
  } as unknown as ProjectManagementPlugin;

  return new ProjectManagementSettingTab({} as App, plugin);
}

describe('ProjectManagementSettingTab', () => {
  it('declares its settings through getSettingDefinitions', () => {
    const definitions = buildTab().getSettingDefinitions();
    const names = definitions.map((item) => (item as { name: string }).name);

    expect(names).toContain('GitHub token');
    expect(names).toContain('Todoist token');
    expect(names).toContain('Poll interval (minutes)');

    const githubRow = definitions.find(
      (item) => (item as { name: string }).name === 'GitHub token',
    ) as { desc: string };
    expect(githubRow.desc).toContain(
      'Personal access token used to talk to the GitHub API.',
    );
  });

  it('renders from the declarative definitions, not the deprecated display override', () => {
    const overridesDisplay = Object.prototype.hasOwnProperty.call(
      ProjectManagementSettingTab.prototype,
      'display',
    );

    expect(overridesDisplay).toBe(false);
  });
});
