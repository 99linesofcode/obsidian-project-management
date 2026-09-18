import { Plugin } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  ProjectManagementSettingTab,
  type ProjectManagementSettings,
} from './App/Settings/PluginSettingTab.js';

export default class ProjectManagementPlugin extends Plugin {
  declare settings: ProjectManagementSettings;

  override async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new ProjectManagementSettingTab(this.app, this));
  }

  override onunload(): void {
    // Nothing to tear down yet; later tickets add the sync scheduler here.
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
