import {
  App,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
} from 'obsidian';
import type ProjectManagementPlugin from '../../main.js';
import { isRecord } from '../../shared/isRecord.js';
import { GITHUB_TOKEN_KEY, TODOIST_TOKEN_KEY } from './SecretStorageAdapter.js';
import { TokenSettings } from './TokenSettings.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { SEED_ARTIFACTS, type SeedArtifact } from '../seedArtifacts.js';

// The DOM lib is not in the type environment, so the input element's type
// attribute is reached through a structural guard rather than the unresolved
// HTMLInputElement type.
function setPasswordInput(input: unknown): void {
  if (isRecord(input)) {
    input.type = 'password';
  }
}

export class ProjectManagementSettingTab extends PluginSettingTab {
  plugin: ProjectManagementPlugin;

  constructor(app: App, plugin: ProjectManagementPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // The declarative definitions Obsidian 1.13+ renders and indexes for
  // settings search. Each row reuses the same populate method as the
  // imperative display() fallback, so the two paths cannot drift. On 1.13+
  // Obsidian renders these and does not call display(); on older versions
  // display() renders the same rows imperatively.
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'GitHub token',
        desc: 'Personal access token used to talk to the GitHub API.',
        render: (setting) =>
          this.populateTokenSetting(
            setting,
            'GitHub token',
            'Personal access token used to talk to the GitHub API.',
            GITHUB_TOKEN_KEY,
            () => this.update(),
          ),
      },
      {
        name: 'Todoist token',
        desc: 'Personal API token used to talk to the Todoist API.',
        render: (setting) =>
          this.populateTokenSetting(
            setting,
            'Todoist token',
            'Personal API token used to talk to the Todoist API.',
            TODOIST_TOKEN_KEY,
            () => this.update(),
          ),
      },
      {
        name: 'Poll interval (minutes)',
        desc: 'How often to check for changes.',
        render: (setting) => this.populatePollInterval(setting),
      },
      {
        name: 'Done option name',
        desc: 'The GitHub Projects single-select option that marks a task done.',
        render: (setting) => this.populateDoneOption(setting),
      },
      {
        name: 'Debounce (seconds)',
        desc: 'How long to wait after a vault change before syncing.',
        render: (setting) => this.populateDebounce(setting),
      },
      ...SEED_ARTIFACTS.map((artifact) => ({
        name: artifact.label,
        desc: artifact.description,
        render: (setting: Setting) =>
          this.populateArtifactSetting(setting, artifact, () => this.update()),
      })),
    ];
  }

  // The imperative fallback for Obsidian older than 1.13.0, which does not
  // read getSettingDefinitions(). It renders the same rows through the same
  // populate methods, so the two paths stay in step.
  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.populateTokenSetting(
      new Setting(containerEl),
      'GitHub token',
      'Personal access token used to talk to the GitHub API.',
      GITHUB_TOKEN_KEY,
      () => this.display(),
    );
    this.populateTokenSetting(
      new Setting(containerEl),
      'Todoist token',
      'Personal API token used to talk to the Todoist API.',
      TODOIST_TOKEN_KEY,
      () => this.display(),
    );
    this.populatePollInterval(new Setting(containerEl));
    this.populateDoneOption(new Setting(containerEl));
    this.populateDebounce(new Setting(containerEl));

    for (const artifact of SEED_ARTIFACTS) {
      this.populateArtifactSetting(new Setting(containerEl), artifact, () =>
        this.display(),
      );
    }
  }

  private populatePollInterval(setting: Setting): void {
    setting
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
  }

  private populateDoneOption(setting: Setting): void {
    setting
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
  }

  private populateDebounce(setting: Setting): void {
    setting
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
  }

  // A path row for one vault artifact: the path input and a Scaffold button.
  // The button is a no-op when the file already exists, so it is safe to press
  // repeatedly. `refresh` re-renders the tab through whichever path is active.
  private populateArtifactSetting(
    setting: Setting,
    artifact: SeedArtifact,
    refresh: () => void,
  ): void {
    setting
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
            refresh();
          }),
      );
  }

  // A token row: a stored/not-set indicator, a password field for a new value,
  // and Set/Clear actions. The stored value is never read back into the field;
  // the indicator is the only place the stored state is shown. Clearing writes
  // the empty state to SecretStorage. `refresh` re-renders the tab through
  // whichever path is active.
  private populateTokenSetting(
    setting: Setting,
    name: string,
    desc: string,
    key: string,
    refresh: () => void,
  ): void {
    const tokens = new TokenSettings(this.plugin.secrets);
    const stored = tokens.isStored(key);
    setting
      .setName(name)
      .setDesc(
        stored
          ? `${desc} Stored in Obsidian's secret storage.`
          : `${desc} Not set.`,
      );

    let draft = '';
    setting.addText((text) => {
      setPasswordInput(text.inputEl);
      text.setPlaceholder('Paste a new token').onChange((value) => {
        draft = value;
      });
    });
    setting.addButton((button) =>
      button.setButtonText('Set').onClick(() => {
        tokens.set(key, draft);
        refresh();
      }),
    );
    setting.addButton((button) =>
      button.setButtonText('Clear').onClick(() => {
        tokens.clear(key);
        refresh();
      }),
    );
  }
}