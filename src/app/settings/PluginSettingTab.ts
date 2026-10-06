import { App, PluginSettingTab, Setting } from 'obsidian';
import type ProjectManagementPlugin from '../../main.js';
import { GITHUB_TOKEN_KEY, TODOIST_TOKEN_KEY } from './SecretStorageAdapter.js';
import { TokenSettings } from './TokenSettings.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { SEED_ARTIFACTS, type SeedArtifact } from '../seedArtifacts.js';

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

    // The six vault-owned artifacts the plugin seeds on first run. Each row is
    // the configured path plus a Scaffold button that creates the file when it
    // is missing — the same create-if-missing semantics as the onload seed.
    for (const artifact of SEED_ARTIFACTS) {
      this.artifactSetting(artifact);
    }
  }

  // A path row for one vault artifact: the path input and a Scaffold button.
  // The button is a no-op when the file already exists, so it is safe to press
  // repeatedly.
  private artifactSetting(artifact: SeedArtifact): void {
    new Setting(this.containerEl)
      .setName(artifact.label)
      .setDesc(artifact.description)
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS[artifact.settingKey])
          .setValue(this.plugin.settings[artifact.settingKey])
          .onChange(async (value) => {
            this.plugin.settings[artifact.settingKey] = value.trim();
            await this.plugin.saveSettings();
          }),
      )
      .addButton((button) =>
        button
          .setButtonText('Scaffold')
          .setTooltip('Create this file if it does not exist')
          .onClick(async () => {
            await this.plugin.seedArtifacts.executeOne(artifact.key);
            this.display();
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
