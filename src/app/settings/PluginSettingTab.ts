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

function setPasswordInput(input: unknown): void {
  if (isRecord(input)) {
    input.type = 'password';
  }
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

interface SettingRow {
  name: string;
  desc: string;
  populate: (setting: Setting, desc: string, refresh: () => void) => void;
}

export class ProjectManagementSettingTab extends PluginSettingTab {
  plugin: ProjectManagementPlugin;
  private readonly tokens: TokenSettings;

  constructor(app: App, plugin: ProjectManagementPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.tokens = new TokenSettings(plugin.secrets);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return this.rows().map((row) => ({
      name: row.name,
      desc: row.desc,
      render: (setting) => row.populate(setting, row.desc, () => this.update()),
    }));
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    for (const row of this.rows()) {
      const setting = new Setting(containerEl)
        .setName(row.name)
        .setDesc(row.desc);
      row.populate(setting, row.desc, () => this.display());
    }
  }

  private rows(): SettingRow[] {
    return [
      {
        name: 'GitHub token',
        desc: 'Personal access token used to talk to the GitHub API.',
        populate: (setting, desc, refresh) =>
          this.populateTokenSetting(setting, desc, GITHUB_TOKEN_KEY, refresh),
      },
      {
        name: 'Todoist token',
        desc: 'Personal API token used to talk to the Todoist API.',
        populate: (setting, desc, refresh) =>
          this.populateTokenSetting(setting, desc, TODOIST_TOKEN_KEY, refresh),
      },
      {
        name: 'Poll interval (minutes)',
        desc: 'How often to check for changes.',
        populate: (setting) => this.populatePollInterval(setting),
      },
      {
        name: 'Done option name',
        desc: 'The GitHub Projects single-select option that marks a task done.',
        populate: (setting) => this.populateDoneOption(setting),
      },
      {
        name: 'Debounce (seconds)',
        desc: 'How long to wait after a vault change before syncing.',
        populate: (setting) => this.populateDebounce(setting),
      },
      {
        name: 'Status options',
        desc: 'The Status lanes a newly created board gets (comma-separated).',
        populate: (setting) => this.populateStatusOptions(setting),
      },
      {
        name: 'Type labels',
        desc: 'The type-label vocabulary the seed action applies (comma-separated).',
        populate: (setting) => this.populateTypeLabels(setting),
      },
      {
        name: 'Seed type labels',
        desc: 'Create the configured type labels on a repository (owner/name).',
        populate: (setting, _desc, refresh) =>
          this.populateLabelSeed(setting, refresh),
      },
      ...SEED_ARTIFACTS.map((artifact) => ({
        name: artifact.label,
        desc: artifact.description,
        populate: (setting: Setting, _desc: string, refresh: () => void) =>
          this.populateArtifactSetting(setting, artifact, refresh),
      })),
    ];
  }

  private populatePollInterval(setting: Setting): void {
    setting.addText((text) =>
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
    setting.addText((text) =>
      text
        .setValue(this.plugin.settings.doneOptionName)
        .onChange(async (value) => {
          this.plugin.settings.doneOptionName = value;
          await this.plugin.saveSettings();
        }),
    );
  }

  private populateDebounce(setting: Setting): void {
    setting.addText((text) =>
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

  private populateStatusOptions(setting: Setting): void {
    setting.addText((text) =>
      text
        .setValue(this.plugin.settings.statusOptions.join(', '))
        .onChange(async (value) => {
          this.plugin.settings.statusOptions = parseList(value);
          await this.plugin.saveSettings();
        }),
    );
  }

  private populateTypeLabels(setting: Setting): void {
    setting.addText((text) =>
      text
        .setValue(this.plugin.settings.typeLabels.join(', '))
        .onChange(async (value) => {
          this.plugin.settings.typeLabels = parseList(value);
          await this.plugin.saveSettings();
        }),
    );
  }

  private populateLabelSeed(setting: Setting, refresh: () => void): void {
    let repo = '';
    setting
      .addText((text) =>
        text.setPlaceholder('owner/name').onChange((value) => {
          repo = value;
        }),
      )
      .addButton((button) =>
        button
          .setButtonText('Seed')
          .setTooltip('Create the configured type labels that are missing')
          .onClick(async () => {
            await this.plugin.seedTypeLabels.execute(
              repo,
              this.plugin.settings.typeLabels,
            );
            refresh();
          }),
      );
  }

  private populateArtifactSetting(
    setting: Setting,
    artifact: SeedArtifact,
    refresh: () => void,
  ): void {
    setting
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

  private populateTokenSetting(
    setting: Setting,
    desc: string,
    key: string,
    refresh: () => void,
  ): void {
    const stored = this.tokens.isStored(key);
    setting.setDesc(
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
        this.tokens.set(key, draft);
        refresh();
      }),
    );
    setting.addButton((button) =>
      button.setButtonText('Clear').onClick(() => {
        this.tokens.clear(key);
        refresh();
      }),
    );
  }
}
