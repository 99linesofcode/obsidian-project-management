import { App, PluginSettingTab, Setting } from 'obsidian';
import type ProjectManagementPlugin from '../../main.js';
import { GITHUB_TOKEN_KEY, TODOIST_TOKEN_KEY } from './SecretStorageAdapter.js';
import { TokenSettings } from './TokenSettings.js';

export class ProjectManagementSettingTab extends PluginSettingTab {
  plugin: ProjectManagementPlugin;

  constructor(app: App, plugin: ProjectManagementPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.tokenSetting(
      'GitHub token',
      'Personal access token used to talk to the GitHub API.',
      GITHUB_TOKEN_KEY,
    );
    this.tokenSetting(
      'Todoist token',
      'Personal API token used to talk to the Todoist API.',
      TODOIST_TOKEN_KEY,
    );

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

    new Setting(containerEl)
      .setName('To-do template')
      .setDesc(
        'Vault path to the template new to-do notes render from. {{date}} and {{time}} resolve to the sync stamp; affiliation, status and completed are filled by the sync. Falls back to the built-in frontmatter when the file is missing.',
      )
      .addText((text) =>
        text
          .setPlaceholder('Templates/ToDo.md')
          .setValue(this.plugin.settings.todoTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.todoTemplatePath = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }

  // A token row: a stored/not-set indicator, a password field for a new value,
  // and Set/Clear actions. The stored value is never read back into the field;
  // the indicator is the only place the stored state is shown. Clearing writes
  // the empty state to SecretStorage.
  private tokenSetting(name: string, desc: string, key: string): void {
    const tokens = new TokenSettings(this.plugin.secrets);
    const stored = tokens.isStored(key);
    const setting = new Setting(this.containerEl)
      .setName(name)
      .setDesc(
        stored
          ? `${desc} Stored in Obsidian's secret storage.`
          : `${desc} Not set.`,
      );

    let draft = '';
    setting.addText((text) => {
      text.inputEl.type = 'password';
      text.setPlaceholder('Paste a new token').onChange((value) => {
        draft = value;
      });
    });
    setting.addButton((button) =>
      button.setButtonText('Set').onClick(() => {
        tokens.set(key, draft);
        this.display();
      }),
    );
    setting.addButton((button) =>
      button.setButtonText('Clear').onClick(() => {
        tokens.clear(key);
        this.display();
      }),
    );
  }
}
