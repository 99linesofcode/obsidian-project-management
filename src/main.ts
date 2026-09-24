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
import { MirrorTodoStatusAction } from './Domain/Actions/MirrorTodoStatusAction.js';
import { PropagateStatusAction } from './Domain/Actions/PropagateStatusAction.js';
import { PushNoteAction } from './Domain/Actions/PushNoteAction.js';
import { PromoteIssueAction } from './Domain/Actions/PromoteIssueAction.js';
import { PromoteCardAction } from './Domain/Actions/PromoteCardAction.js';
import { ProbeProjectsAction } from './Domain/Actions/ProbeProjectsAction.js';
import { ReconcileArchiveStateAction } from './Domain/Actions/ReconcileArchiveStateAction.js';
import { ReconcileTaskAction } from './Domain/Actions/ReconcileTaskAction.js';
import { RelinkRenamedTodoAction } from './Domain/Actions/RelinkRenamedTodoAction.js';
import { RelocateTaskStatusAction } from './Domain/Actions/RelocateTaskStatusAction.js';
import { SyncChecklistAction } from './Domain/Actions/SyncChecklistAction.js';
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
    const createTaskNote = new CreateTaskNoteAction(
      vault,
      syncState,
      this.settings.taskTemplatePath,
    );
    const boardStatus = new BoardStatusAction(syncState, github);
    const applyRemoteChange = new ApplyRemoteChangeAction(
      vault,
      syncState,
      createTaskNote,
      boardStatus,
      this.settings.taskTemplatePath,
    );
    const pushNote = new PushNoteAction(github);
    const propagateStatus = new PropagateStatusAction(
      github,
      syncState,
      boardStatus,
      this.settings.doneOptionName,
    );
    const handleDeletedNote = new HandleDeletedNoteAction(
      syncState,
      github,
      boardStatus,
      this.settings.doneOptionName,
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
      this.settings.doneOptionName,
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
      this.settings.doneOptionName,
    );
    const discoverProjects = new DiscoverProjectsAction(
      vault,
      new AttachProjectAction(github),
    );
    const probeProjects = new ProbeProjectsAction(github, syncState);
    const reconcileArchiveState = new ReconcileArchiveStateAction(
      github,
      vault,
      syncState,
    );

    const syncChecklist = new SyncChecklistAction(
      vault,
      this.settings.todoTemplatePath,
    );
    const mirrorTodoStatus = new MirrorTodoStatusAction(vault);
    const relinkRenamedTodo = new RelinkRenamedTodoAction(vault);
    const relocateTaskStatus = new RelocateTaskStatusAction(syncState);

    const promoteIssue = new PromoteIssueAction(
      github,
      syncState,
      createTaskNote,
    );
    const promoteToTask = new PromoteToTaskCommand(
      () => this.projectNames,
      syncState,
      github,
      promoteIssue,
    );
    promoteToTask.register(this);

    const promoteCard = new PromoteCardAction(
      github,
      syncState,
      createTaskNote,
    );
    const promoteCardToIssue = new PromoteCardToIssueCommand(
      () => this.projectNames,
      syncState,
      github,
      promoteCard,
    );
    promoteCardToIssue.register(this);

    // v1 wiring: the scheduler starts inert and discovers the vault's project
    // notes on every tick, so a folder move is picked up without a stored list.
    const scheduler = new SyncScheduler(
      syncProject,
      probeProjects,
      reconcileArchiveState,
      syncState,
      this.settings.pollIntervalMinutes * 60 * 1000,
      vault,
      syncChecklist,
      mirrorTodoStatus,
      reconcileTask,
      handleDeletedNote,
      relinkRenamedTodo,
      relocateTaskStatus,
      this.settings.debounceSeconds * 1000,
    );
    this.addChild(scheduler);

    this.app.workspace.onLayoutReady(() => {
      void this.discoverAndSync(discoverProjects, syncState);
    });

    this.addSettingTab(new ProjectManagementSettingTab(this.app, this));
  }

  // Discovers the vault's synced projects and persists their identities for
  // later board operations. The scheduler derives its project list from the
  // notes' locations each tick, so discovery only needs to seed the identities.
  // Discovery must never crash the plugin: unexpected failures and per-note
  // errors surface as notices.
  private async discoverAndSync(
    discoverProjects: DiscoverProjectsAction,
    syncState: SyncStateAdapter,
  ): Promise<void> {
    try {
      const { projects, errors } = await discoverProjects.execute();
      for (const project of projects) {
        await syncState.setIdentity(project.projectName, project.identity);
      }
      this.projectNames = projects.map((project) => project.projectName);
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
