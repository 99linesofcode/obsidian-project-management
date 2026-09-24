import { App, PluginSettingTab, Setting } from 'obsidian';
import type ProjectManagementPlugin from '../../main.js';

export interface ProjectManagementSettings {
  githubToken: string;
  pollIntervalMinutes: number;
  doneOptionName: string;
  debounceSeconds: number;
  taskTemplatePath: string;
}

export const DEFAULT_SETTINGS: ProjectManagementSettings = {
  githubToken: '',
  pollIntervalMinutes: 5,
  doneOptionName: 'Shipped',
  debounceSeconds: 2,
  taskTemplatePath: 'Templates/Task.md',
};

export class ProjectManagementSettingTab extends PluginSettingTab {
  plugin: ProjectManagementPlugin;

  constructor(app: App, plugin: ProjectManagementPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('GitHub token')
      .setDesc('Personal access token used to talk to the GitHub API.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('ghp_...')
          .setValue(this.plugin.settings.githubToken)
          .onChange(async (value) => {
            this.plugin.settings.githubToken = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Poll interval (minutes)')
      .setDesc('How often to check for changes.')
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.pollIntervalMinutes))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed > 0) {
              this.plugin.settings.pollIntervalMinutes = parsed;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('Done option name')
      .setDesc(
        'The GitHub Projects single-select option that marks a task done.',
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.doneOptionName)
          .onChange(async (value) => {
            this.plugin.settings.doneOptionName = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Debounce (seconds)')
      .setDesc('How long to wait after a vault change before syncing.')
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.debounceSeconds))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 0) {
              this.plugin.settings.debounceSeconds = parsed;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('Task template')
      .setDesc(
        'Vault path to the template new task notes render from. {{date}} and {{time}} resolve to the sync stamp; url, status, synced and affiliation are filled by the sync. Falls back to the built-in frontmatter when the file is missing.',
      )
      .addText((text) =>
        text
          .setPlaceholder('Templates/Task.md')
          .setValue(this.plugin.settings.taskTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.taskTemplatePath = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }
}
