import { Notice, Plugin, requestUrl } from 'obsidian';
import {
  mergeSettingsIntoData,
  settingsFromData,
  type ProjectManagementSettings,
} from './App/Settings/settings.js';
import { ProjectManagementSettingTab } from './App/Settings/PluginSettingTab.js';
import { SyncScheduler } from './App/Scheduling/SyncScheduler.js';
import { SyncQueue } from './App/Scheduling/SyncQueue.js';
import { AttachProjectAction } from './Domain/Actions/AttachProjectAction.js';
import { CreateTaskNoteAction } from './Domain/Actions/CreateTaskNoteAction.js';
import { ApplyTaskToGithubAction } from './Domain/Actions/ApplyTaskToGithubAction.js';
import { ApplyTaskToTodoistAction } from './Domain/Actions/ApplyTaskToTodoistAction.js';
import { ApplyTaskToVaultAction } from './Domain/Actions/ApplyTaskToVaultAction.js';
import { ApplyTodoistCompletionAction } from './Domain/Actions/ApplyTodoistCompletionAction.js';
import { ApplyTodoistRemoteChangesAction } from './Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import { BoardStatusAction } from './Domain/Actions/BoardStatusAction.js';
import { CaptureTodoistCreationsAction } from './Domain/Actions/CaptureTodoistCreationsAction.js';
import { CaptureRemoteProjectsAction } from './Domain/Actions/CaptureRemoteProjectsAction.js';
import { CompleteTaskCascadeAction } from './Domain/Actions/CompleteTaskCascadeAction.js';
import { DetectNoteRenamesAction } from './Domain/Actions/DetectNoteRenamesAction.js';
import { DiscoverProjectsAction } from './Domain/Actions/DiscoverProjectsAction.js';
import { CleanupNoteFrontmatterAction } from './Domain/Actions/CleanupNoteFrontmatterAction.js';
import { EnsureProjectBoardAction } from './Domain/Actions/EnsureProjectBoardAction.js';
import { EnsureTodoistSectionsAction } from './Domain/Actions/EnsureTodoistSectionsAction.js';
import { HandleDeletedNoteAction } from './Domain/Actions/HandleDeletedNoteAction.js';
import { MirrorTodoStatusAction } from './Domain/Actions/MirrorTodoStatusAction.js';
import { PropagateStatusAction } from './Domain/Actions/PropagateStatusAction.js';
import { PromoteIssueAction } from './Domain/Actions/PromoteIssueAction.js';
import { PromoteCardAction } from './Domain/Actions/PromoteCardAction.js';
import { ProbeProjectsAction } from './Domain/Actions/ProbeProjectsAction.js';
import { PropagateTodoistDeletionsAction } from './Domain/Actions/PropagateTodoistDeletionsAction.js';
import { ReconcileProjectLifecycleAction } from './Domain/Actions/ReconcileProjectLifecycleAction.js';
import { RelinkRenamedTodoAction } from './Domain/Actions/RelinkRenamedTodoAction.js';
import { RelocateTaskStatusAction } from './Domain/Actions/RelocateTaskStatusAction.js';
import { SyncChecklistAction } from './Domain/Actions/SyncChecklistAction.js';
import { SyncGithubTasksAction } from './Domain/Actions/SyncGithubTasksAction.js';
import { SyncProjectAction } from './Domain/Actions/SyncProjectAction.js';
import { SyncTodoistTasksAction } from './Domain/Actions/SyncTodoistTasksAction.js';
import { VerdictResolver } from './Domain/Reconciliation/VerdictResolver.js';
import {
  GitHubAdapter,
  type Transport,
} from './Infrastructure/GitHub/GitHubAdapter.js';
import { VaultAdapter } from './Infrastructure/Obsidian/VaultAdapter.js';
import {
  SyncStateAdapter,
  migrateLegacyState,
} from './Infrastructure/Obsidian/SyncStateAdapter.js';
import { loadDataSafely } from './Infrastructure/Obsidian/loadDataSafely.js';
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
    // Read the root through the safe loader: a corrupt data.json is quarantined
    // rather than silently reset (REG-4). The legacy flat sync-state keys are
    // then migrated under their own top-level key before the settings merge, so
    // the plugin's settings never absorb a `status.*`/`todoistItem.*` record
    // (the pre-t5 shared-root wrinkle).
    const raw = await loadDataSafely(
      () => this.loadData(),
      () => this.quarantineDataFile(),
      () => this.dataFileExists(),
    );
    if (migrateLegacyState(raw)) {
      await this.saveData(raw);
    }
    // The registry container is stripped out of the settings merge: a stale
    // registry snapshot in settings would be written back over every registry
    // write made since onload (REG-3).
    this.settings = settingsFromData(raw);

    const transport = createTransport(this.settings.githubToken);
    const syncState = new SyncStateAdapter({
      load: () =>
        loadDataSafely(
          () => this.loadData(),
          () => this.quarantineDataFile(),
          () => this.dataFileExists(),
        ),
      save: (data) => this.saveData(data),
      backup: () => this.backupDataFile(),
    });
    const vault = new VaultAdapter(this.app, (eventRef) =>
      this.registerEvent(eventRef),
    );

    const github = new GitHubAdapter(transport);
    // The frontmatter cleanup runs at the chain start, per project, before any
    // half reads notes: it strips the legacy `id:`/`url:` fields (dt-20).
    const cleanupNoteFrontmatter = new CleanupNoteFrontmatterAction(vault);
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
      this.settings.doneOptionName,
    );
    // t3: the canonical GitHub half. The two writers render a winning TaskData
    // onto GitHub and the vault; the action fetches the whole project in one
    // query and diffs each entity against the vault and the snapshot.
    const applyTaskToGithub = new ApplyTaskToGithubAction(github, syncState);
    // t6: the dt-13 cascade — a done task completes its checklist line and its
    // still-open to-dos. Composed into the vault writer (the pull path) and the
    // chain's vault-consistency step (every other origin).
    const completeTaskCascade = new CompleteTaskCascadeAction(
      vault,
      this.settings.doneOptionName,
    );
    const applyTaskToVault = new ApplyTaskToVaultAction(
      vault,
      syncState,
      createTaskNote,
      this.settings.taskTemplatePath,
      completeTaskCascade,
    );
    const syncGithubTasks = new SyncGithubTasksAction(
      github,
      syncState,
      vault,
      applyTaskToGithub,
      applyTaskToVault,
      new VerdictResolver(this.settings.doneOptionName),
      this.settings.doneOptionName,
    );
    const discoverProjects = new DiscoverProjectsAction(
      vault,
      new AttachProjectAction(github),
    );
    const probeProjects = new ProbeProjectsAction(github, syncState);

    // The Todoist half of the tick: the adapter is token-bound through its
    // transport, so a missing token surfaces as a failed request, not a crash.
    const todoist = new TodoistAdapter(
      createTodoistTransport(this.settings.todoistToken),
    );
    // t4: ONE lifecycle action with ONE freeze verdict. It merges the former
    // archive-state, Todoist-project and archived-watch actions: folder ⇄
    // archive ⇄ Todoist two-way, name drift, frozen projects still polled by
    // id, and the ETag + newest-issue watch.
    const reconcileProjectLifecycle = new ReconcileProjectLifecycleAction(
      github,
      todoist,
      vault,
      syncState,
      this.settings.doneOptionName,
    );
    // t4: the gated Todoist writer. It absorbs the two projection actions'
    // write paths: content/section/parent/completed, writing only the fields
    // that differ. The pipeline resolves the desired shape and placement.
    const applyTaskToTodoist = new ApplyTaskToTodoistAction(
      todoist,
      syncState,
    );
    const applyTodoistCompletion = new ApplyTodoistCompletionAction(
      vault,
      syncState,
      applyTaskToVault,
      this.settings.doneOptionName,
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
      vault,
      syncState,
      propagateStatus,
      relocateTaskStatus,
      relinkRenamedTodo,
      this.settings.doneOptionName,
    );
    const captureTodoistCreations = new CaptureTodoistCreationsAction(
      vault,
      syncState,
      this.settings.todoTemplatePath,
      this.settings.doneOptionName,
    );
    // The project-propagation legs: capture remote-born projects into the
    // vault (PRJ-2/PRJ-3), then the chain's board step completes PRJ-1.
    const captureRemoteProjects = new CaptureRemoteProjectsAction(
      github,
      todoist,
      vault,
      syncState,
      this.settings.doneOptionName,
    );
    const ensureProjectBoard = new EnsureProjectBoardAction(
      github,
      vault,
      syncState,
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

    // t4: the chain composes the rebuilt halves; the queue serialises every
    // project; the scheduler is discovery + timing policies only.
    const syncTodoistTasks = new SyncTodoistTasksAction(
      todoist,
      github,
      vault,
      syncState,
      new EnsureTodoistSectionsAction(todoist),
      applyTaskToTodoist,
      applyTodoistRemoteChanges,
      captureTodoistCreations,
      applyTodoistCompletion,
      propagateTodoistDeletions,
      this.settings.doneOptionName,
    );
    const detectNoteRenames = new DetectNoteRenamesAction(vault, syncState);
    const syncProject = new SyncProjectAction(
      vault,
      syncState,
      probeProjects,
      reconcileProjectLifecycle,
      detectNoteRenames,
      syncGithubTasks,
      completeTaskCascade,
      syncChecklist,
      mirrorTodoStatus,
      syncTodoistTasks,
      handleDeletedNote,
      cleanupNoteFrontmatter,
      ensureProjectBoard,
    );
    const queue = new SyncQueue(syncProject);
    const scheduler = new SyncScheduler(
      vault,
      queue,
      this.settings.pollIntervalMinutes * 60 * 1000,
      this.settings.debounceSeconds * 1000,
      () =>
        captureRemoteProjects.execute({ syncedAt: new Date().toISOString() }),
    );
    this.addChild(scheduler);

    this.app.workspace.onLayoutReady(() => {
      void this.discoverAndSync(
        discoverProjects,
        syncState,
        captureRemoteProjects,
      );
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
    captureRemoteProjects: CaptureRemoteProjectsAction,
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
      // Capture remote-born projects AFTER discovery, so a just-created vault
      // project is not re-attached this startup. The captured names are picked
      // up by the scheduler's next tick.
      await captureRemoteProjects.execute({
        syncedAt: new Date().toISOString(),
      });
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
    // Merge into a FRESH read of data.json so registry writes made after onload
    // survive a settings save (REG-2/REG-3).
    const data = (await this.loadData()) ?? {};
    await this.saveData(mergeSettingsIntoData(data, this.settings));
  }

  // Obsidian's saveData is a whole-file write, so a crash mid-write can
  // truncate data.json. Before a registry overwrite the adapter asks for a
  // rolling backup of the current file (throttled to at most once a minute), so
  // the next start can fall back to the previous state (REG-4). Best-effort: a
  // failed copy must never block a registry write.
  private async backupDataFile(): Promise<void> {
    const path = this.dataFilePath();
    if (path === null) {
      return;
    }
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path))) {
      return;
    }
    await adapter.copy(path, `${path}.bak`);
  }

  // A data.json that exists but cannot be parsed must never be silently reset:
  // its bytes may still be recoverable by hand. Move it aside so the next load
  // starts clean and the plugin keeps running, rather than overwriting the
  // corrupt file with an empty registry.
  private async quarantineDataFile(): Promise<void> {
    const path = this.dataFilePath();
    if (path === null || !(await this.dataFileExists())) {
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await this.app.vault.adapter.rename(path, `${path}.corrupt-${stamp}`);
  }

  private async dataFileExists(): Promise<boolean> {
    const path = this.dataFilePath();
    return path !== null && (await this.app.vault.adapter.exists(path));
  }

  // The plugin's own data.json path, or null before Obsidian has assigned a
  // manifest directory.
  private dataFilePath(): string | null {
    const dir = this.manifest.dir;
    return dir === undefined ? null : `${dir}/data.json`;
  }
}
