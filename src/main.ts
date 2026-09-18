import { Plugin, requestUrl } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  ProjectManagementSettingTab,
  type ProjectManagementSettings,
} from './App/Settings/PluginSettingTab.js';
import { SyncScheduler } from './App/Scheduling/SyncScheduler.js';
import { CreateTaskNoteAction } from './Domain/Actions/CreateTaskNoteAction.js';
import { ApplyRemoteChangeAction } from './Domain/Actions/ApplyRemoteChangeAction.js';
import { SyncProjectAction } from './Domain/Actions/SyncProjectAction.js';
import { GitHubAdapter, type Transport } from './Infrastructure/GitHub/GitHubAdapter.js';
import { VaultAdapter } from './Infrastructure/Obsidian/VaultAdapter.js';
import { SyncStateAdapter } from './Infrastructure/Obsidian/SyncStateAdapter.js';

// Builds the transport the GitHub adapter talks through. The adapter stays
// token-agnostic; the Authorization header is added here. GraphQL goes over
// POST to the GraphQL endpoint, the REST since-poll over GET to the REST
// endpoint.
function createTransport(token: string): Transport {
  return {
    async post(body) {
      const response = await requestUrl({
        url: 'https://api.github.com/graphql',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
      });
      return { status: response.status, json: response.json };
    },
    async get(path) {
      const response = await requestUrl({
        url: `https://api.github.com${path}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: response.status, json: response.json };
    },
  };
}

export default class ProjectManagementPlugin extends Plugin {
  declare settings: ProjectManagementSettings;

  override async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    const transport = createTransport(this.settings.githubToken);
    const syncState = new SyncStateAdapter({
      load: () => this.loadData() as Promise<Record<string, unknown>>,
      save: (data) => this.saveData(data),
    });
    const vault = new VaultAdapter(this.app);

    // v1 wiring: project discovery (enumerating the attached project notes)
    // lands in a later ticket. The adapter is bound to one repo and the
    // scheduler to the resolved project names; with none discovered yet the
    // scheduler is inert but the architecture is in place. At startup each
    // attached project would run AttachProjectAction once to resolve its
    // identities.
    const repoUrl = '';
    const projectNames: string[] = [];

    const github = new GitHubAdapter(transport, repoUrl);
    const createTaskNote = new CreateTaskNoteAction(vault, syncState);
    const applyRemoteChange = new ApplyRemoteChangeAction(vault, syncState, createTaskNote);
    const syncProject = new SyncProjectAction(
      github,
      syncState,
      applyRemoteChange,
      createTaskNote,
    );

    const scheduler = new SyncScheduler(
      syncProject,
      projectNames,
      this.settings.pollIntervalMinutes * 60 * 1000,
    );
    this.addChild(scheduler);

    this.addSettingTab(new ProjectManagementSettingTab(this.app, this));
  }

  override onunload(): void {
    // Children (the scheduler) are unloaded automatically by the plugin.
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
