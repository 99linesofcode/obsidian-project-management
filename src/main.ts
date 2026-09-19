import { Notice, Plugin, requestUrl } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  ProjectManagementSettingTab,
  type ProjectManagementSettings,
} from './App/Settings/PluginSettingTab.js';
import { SyncScheduler } from './App/Scheduling/SyncScheduler.js';
import { AttachProjectAction } from './Domain/Actions/AttachProjectAction.js';
import { CreateTaskNoteAction } from './Domain/Actions/CreateTaskNoteAction.js';
import { ApplyRemoteChangeAction } from './Domain/Actions/ApplyRemoteChangeAction.js';
import { ApplyBoardChangeAction } from './Domain/Actions/ApplyBoardChangeAction.js';
import { BoardStatusAction } from './Domain/Actions/BoardStatusAction.js';
import { DiscoverProjectsAction } from './Domain/Actions/DiscoverProjectsAction.js';
import { HandleDeletedNoteAction } from './Domain/Actions/HandleDeletedNoteAction.js';
import { PropagateStatusAction } from './Domain/Actions/PropagateStatusAction.js';
import { PushNoteAction } from './Domain/Actions/PushNoteAction.js';
import { PromoteIssueAction } from './Domain/Actions/PromoteIssueAction.js';
import { PromoteCardAction } from './Domain/Actions/PromoteCardAction.js';
import { ReconcileTaskAction } from './Domain/Actions/ReconcileTaskAction.js';
import { SyncProjectAction } from './Domain/Actions/SyncProjectAction.js';
import { VerdictResolver } from './Domain/Reconciliation/VerdictResolver.js';
import {
  GitHubAdapter,
  type Transport,
} from './Infrastructure/GitHub/GitHubAdapter.js';
import { VaultAdapter } from './Infrastructure/Obsidian/VaultAdapter.js';
import { SyncStateAdapter } from './Infrastructure/Obsidian/SyncStateAdapter.js';
import { PromoteToTaskCommand } from './App/Commands/PromoteToTaskCommand.js';
import { PromoteCardToIssueCommand } from './App/Commands/PromoteCardToIssueCommand.js';

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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
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
    async patch(path, body) {
      const response = await requestUrl({
        url: `https://api.github.com${path}`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
      });
      return { status: response.status, json: response.json };
    },
    async postPath(path, body) {
      const response = await requestUrl({
        url: `https://api.github.com${path}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
      });
      return { status: response.status, json: response.json };
    },
  };
}

export default class ProjectManagementPlugin extends Plugin {
  declare settings: ProjectManagementSettings;
  private projectNames: string[] = [];

  override async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    const transport = createTransport(this.settings.githubToken);
    const syncState = new SyncStateAdapter({
      load: () => this.loadData() as Promise<Record<string, unknown>>,
      save: (data) => this.saveData(data),
    });
    const vault = new VaultAdapter(this.app, (eventRef) =>
      this.registerEvent(eventRef),
    );

    const github = new GitHubAdapter(transport);
    const createTaskNote = new CreateTaskNoteAction(vault, syncState);
    const boardStatus = new BoardStatusAction(
      syncState,
      github,
      this.settings.doneOptionName,
    );
    const applyRemoteChange = new ApplyRemoteChangeAction(
      vault,
      syncState,
      createTaskNote,
      boardStatus,
    );
    const pushNote = new PushNoteAction(github);
    const propagateStatus = new PropagateStatusAction(
      github,
      syncState,
      boardStatus,
    );
    const handleDeletedNote = new HandleDeletedNoteAction(
      syncState,
      github,
      boardStatus,
    );
    const reconcileTask = new ReconcileTaskAction(
      vault,
      syncState,
      github,
      createTaskNote,
      applyRemoteChange,
      pushNote,
      propagateStatus,
      new VerdictResolver(),
    );
    const applyBoardChange = new ApplyBoardChangeAction(
      syncState,
      github,
      vault,
      this.settings.doneOptionName,
    );
    const syncProject = new SyncProjectAction(
      github,
      syncState,
      applyRemoteChange,
      createTaskNote,
      applyBoardChange,
    );
    const discoverProjects = new DiscoverProjectsAction(
      vault,
      new AttachProjectAction(github),
    );

    const promoteIssue = new PromoteIssueAction(github, createTaskNote);
    const promoteToTask = new PromoteToTaskCommand(
      () => this.projectNames,
      syncState,
      github,
      promoteIssue,
    );
    promoteToTask.register(this);

    const promoteCard = new PromoteCardAction(github, createTaskNote);
    const promoteCardToIssue = new PromoteCardToIssueCommand(
      () => this.projectNames,
      syncState,
      github,
      promoteCard,
    );
    promoteCardToIssue.register(this);

    // v1 wiring: the scheduler starts inert (no projects) and is populated
    // once the vault's project notes are discovered after layout is ready.
    const scheduler = new SyncScheduler(
      syncProject,
      [],
      this.settings.pollIntervalMinutes * 60 * 1000,
      vault,
      reconcileTask,
      handleDeletedNote,
      this.settings.debounceSeconds * 1000,
    );
    this.addChild(scheduler);

    this.app.workspace.onLayoutReady(() => {
      void this.discoverAndSync(discoverProjects, syncState, scheduler);
    });

    this.addSettingTab(new ProjectManagementSettingTab(this.app, this));
  }

  // Discovers the vault's synced projects, persists their identities for
  // later board operations, and hands the project names to the scheduler so
  // its tick syncs each discovered project. Discovery must never crash the
  // plugin: unexpected failures and per-note errors surface as notices.
  private async discoverAndSync(
    discoverProjects: DiscoverProjectsAction,
    syncState: SyncStateAdapter,
    scheduler: SyncScheduler,
  ): Promise<void> {
    try {
      const { projects, errors } = await discoverProjects.execute();
      for (const project of projects) {
        await syncState.setIdentity(project.projectName, project.identity);
      }
      this.projectNames = projects.map((project) => project.projectName);
      scheduler.setProjectNames(projects.map((project) => project.projectName));
      if (errors.length > 0) {
        new Notice(
          `Project discovery: ${errors.length} project(s) could not be attached`,
        );
      }
    } catch (error) {
      new Notice(
        `Project discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  override onunload(): void {
    // Children (the scheduler) are unloaded automatically by the plugin.
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
