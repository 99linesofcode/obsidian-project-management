import { Notice, Plugin, requestUrl } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  ProjectManagementSettingTab,
  type ProjectManagementSettings,
} from './App/Settings/PluginSettingTab.js';
import { SyncScheduler } from './App/Scheduling/SyncScheduler.js';
import { SyncQueue } from './App/Scheduling/SyncQueue.js';
import { AttachProjectAction } from './Domain/Actions/AttachProjectAction.js';
import { CreateTaskNoteAction } from './Domain/Actions/CreateTaskNoteAction.js';
import { ApplyTaskToGithubAction } from './Domain/Actions/ApplyTaskToGithubAction.js';
import { ApplyTaskToVaultAction } from './Domain/Actions/ApplyTaskToVaultAction.js';
import { ApplyTodoistCompletionAction } from './Domain/Actions/ApplyTodoistCompletionAction.js';
import { ApplyTodoistRemoteChangesAction } from './Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import { BoardStatusAction } from './Domain/Actions/BoardStatusAction.js';
import { CaptureTodoistCreationsAction } from './Domain/Actions/CaptureTodoistCreationsAction.js';
import { DetectNoteRenamesAction } from './Domain/Actions/DetectNoteRenamesAction.js';
import { DiscoverProjectsAction } from './Domain/Actions/DiscoverProjectsAction.js';
import { EnsureTodoistSectionsAction } from './Domain/Actions/EnsureTodoistSectionsAction.js';
import { HandleDeletedNoteAction } from './Domain/Actions/HandleDeletedNoteAction.js';
import { MirrorTodoStatusAction } from './Domain/Actions/MirrorTodoStatusAction.js';
import { PropagateStatusAction } from './Domain/Actions/PropagateStatusAction.js';
import { PromoteIssueAction } from './Domain/Actions/PromoteIssueAction.js';
import { PromoteCardAction } from './Domain/Actions/PromoteCardAction.js';
import { ProbeProjectsAction } from './Domain/Actions/ProbeProjectsAction.js';
import { ProjectTasksToTodoistAction } from './Domain/Actions/ProjectTasksToTodoistAction.js';
import { ProjectToDosToTodoistAction } from './Domain/Actions/ProjectToDosToTodoistAction.js';
import { PropagateTodoistDeletionsAction } from './Domain/Actions/PropagateTodoistDeletionsAction.js';
import { ReconcileArchiveStateAction } from './Domain/Actions/ReconcileArchiveStateAction.js';
import { ReconcileTodoistProjectAction } from './Domain/Actions/ReconcileTodoistProjectAction.js';
import { RelinkRenamedTodoAction } from './Domain/Actions/RelinkRenamedTodoAction.js';
import { RelocateTaskStatusAction } from './Domain/Actions/RelocateTaskStatusAction.js';
import { SyncChecklistAction } from './Domain/Actions/SyncChecklistAction.js';
import { SyncGithubTasksAction } from './Domain/Actions/SyncGithubTasksAction.js';
import { SyncProjectAction } from './Domain/Actions/SyncProjectAction.js';
import { SyncTodoistTasksAction } from './Domain/Actions/SyncTodoistTasksAction.js';
import { WatchArchivedProjectAction } from './Domain/Actions/WatchArchivedProjectAction.js';
import { VerdictResolver } from './Domain/Reconciliation/VerdictResolver.js';
import {
  GitHubAdapter,
  type Transport,
} from './Infrastructure/GitHub/GitHubAdapter.js';
import { VaultAdapter } from './Infrastructure/Obsidian/VaultAdapter.js';
import { SyncStateAdapter } from './Infrastructure/Obsidian/SyncStateAdapter.js';
import {
  TodoistAdapter,
  createTodoistTransport,
} from './Infrastructure/Todoist/TodoistAdapter.js';
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
    async getConditional(path, etag) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (etag) {
        headers['If-None-Match'] = etag;
      }
      // throw: false so a 304 comes back as a response rather than an error.
      const response = await requestUrl({
        url: `https://api.github.com${path}`,
        method: 'GET',
        headers,
        throw: false,
      });
      const responseEtag = response.headers['etag'];
      return responseEtag === undefined
        ? { status: response.status, json: response.json }
        : { status: response.status, json: response.json, etag: responseEtag };
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
    // t3: the canonical GitHub half. The two writers render a winning TaskData
    // onto GitHub and the vault; the action fetches the whole project in one
    // query and diffs each entity against the vault and the snapshot.
    const applyTaskToGithub = new ApplyTaskToGithubAction(github, syncState);
    const applyTaskToVault = new ApplyTaskToVaultAction(
      vault,
      syncState,
      createTaskNote,
      this.settings.taskTemplatePath,
    );
    const syncGithubTasks = new SyncGithubTasksAction(
      github,
      syncState,
      vault,
      applyTaskToGithub,
      applyTaskToVault,
      new VerdictResolver(),
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
      this.settings.doneOptionName,
    );
    const watchArchivedProject = new WatchArchivedProjectAction(
      github,
      syncState,
      reconcileArchiveState,
    );

    // The Todoist half of the tick: the adapter is token-bound through its
    // transport, so a missing token surfaces as a failed request, not a crash.
    const todoist = new TodoistAdapter(
      createTodoistTransport(this.settings.todoistToken),
    );
    const reconcileTodoistProject = new ReconcileTodoistProjectAction(
      todoist,
      vault,
      syncState,
    );
    const projectTasksToTodoist = new ProjectTasksToTodoistAction(
      todoist,
      github,
      vault,
      syncState,
      new EnsureTodoistSectionsAction(todoist),
      this.settings.doneOptionName,
    );
    const applyTodoistCompletion = new ApplyTodoistCompletionAction(
      todoist,
      vault,
      syncState,
    );
    const projectToDosToTodoist = new ProjectToDosToTodoistAction(
      todoist,
      vault,
      syncState,
    );
    // t6: a deleted note's twin is removed, subtree included, and its records
    // evicted. Keyed on the note's absence, so a completed twin (absent from
    // the active set) is never deleted, and a remotely deleted twin is
    // self-healed by the projection.
    const propagateTodoistDeletions = new PropagateTodoistDeletionsAction(
      todoist,
      vault,
      syncState,
    );

    const syncChecklist = new SyncChecklistAction(
      vault,
      this.settings.todoTemplatePath,
    );
    const mirrorTodoStatus = new MirrorTodoStatusAction(vault);
    const relinkRenamedTodo = new RelinkRenamedTodoAction(vault, syncState);
    const relocateTaskStatus = new RelocateTaskStatusAction(syncState);

    // t5: absorb the remote side before the projections push. The verdict
    // action applies content/lane/parent changes; the creation action captures
    // Todoist-created items per the dt-06 table. Both reuse the rename and
    // status machinery the vault-driven paths use.
    const applyTodoistRemoteChanges = new ApplyTodoistRemoteChangesAction(
      todoist,
      vault,
      syncState,
      propagateStatus,
      relocateTaskStatus,
      relinkRenamedTodo,
      this.settings.doneOptionName,
    );
    const captureTodoistCreations = new CaptureTodoistCreationsAction(
      todoist,
      vault,
      syncState,
      this.settings.todoTemplatePath,
      this.settings.doneOptionName,
    );

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

    // t2: the chain composes the interim halves; the queue serialises every
    // project; the scheduler is discovery + timing policies only.
    const syncTodoistTasks = new SyncTodoistTasksAction(
      reconcileTodoistProject,
      applyTodoistRemoteChanges,
      captureTodoistCreations,
      projectTasksToTodoist,
      applyTodoistCompletion,
      projectToDosToTodoist,
      propagateTodoistDeletions,
    );
    const detectNoteRenames = new DetectNoteRenamesAction(
      vault,
      syncState,
      relinkRenamedTodo,
      relocateTaskStatus,
    );
    const syncProject = new SyncProjectAction(
      vault,
      syncState,
      probeProjects,
      reconcileArchiveState,
      watchArchivedProject,
      detectNoteRenames,
      syncGithubTasks,
      syncChecklist,
      mirrorTodoStatus,
      syncTodoistTasks,
      handleDeletedNote,
    );
    const queue = new SyncQueue(syncProject);
    const scheduler = new SyncScheduler(
      vault,
      queue,
      this.settings.pollIntervalMinutes * 60 * 1000,
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
