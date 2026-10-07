import { Notice, Plugin, requestUrl } from 'obsidian';
import {
  mergeSettingsIntoData,
  settingsFromData,
  type ProjectManagementSettings,
} from './app/settings/settings.js';
import {
  GITHUB_TOKEN_KEY,
  SecretStorageAdapter,
  TODOIST_TOKEN_KEY,
  type SecretStore,
} from './app/settings/SecretStorageAdapter.js';
import { transportFromSecret } from './app/settings/transportFromSecret.js';
import { ProjectManagementSettingTab } from './app/settings/PluginSettingTab.js';
import { SeedVaultArtifactsAction } from './app/SeedVaultArtifactsAction.js';
import { SeedTypeLabelsAction } from './app/SeedTypeLabelsAction.js';
import { SyncScheduler } from './app/SyncScheduler.js';
import { SyncQueue } from './app/SyncQueue.js';
import { AttachProjectAction } from './projects/AttachProjectAction.js';
import { CreateTaskNoteAction } from './tasks/CreateTaskNoteAction.js';
import { ApplyTaskToGithubAction } from './github/ApplyTaskToGithubAction.js';
import { ApplyTaskToTodoistAction } from './todoist/ApplyTaskToTodoistAction.js';
import { ApplyTaskToVaultAction } from './tasks/ApplyTaskToVaultAction.js';
import { ApplyTodoistCompletionAction } from './todoist/ApplyTodoistCompletionAction.js';
import { ApplyTodoistRemoteChangesAction } from './todoist/ApplyTodoistRemoteChangesAction.js';
import { BoardStatusAction } from './projects/BoardStatusAction.js';
import { CaptureTodoistCreationsAction } from './todoist/CaptureTodoistCreationsAction.js';
import { CaptureRemoteProjectsAction } from './projects/CaptureRemoteProjectsAction.js';
import { CompleteTaskCascadeAction } from './tasks/CompleteTaskCascadeAction.js';
import { DetectNoteRenamesAction } from './sync/DetectNoteRenamesAction.js';
import { DiscoverProjectsAction } from './projects/DiscoverProjectsAction.js';
import { EnsureProjectBoardAction } from './projects/EnsureProjectBoardAction.js';
import { EnsureTodoistSectionsAction } from './todoist/EnsureTodoistSectionsAction.js';
import { HandleDeletedNoteAction } from './sync/HandleDeletedNoteAction.js';
import { MirrorTodoStatusAction } from './todos/MirrorTodoStatusAction.js';
import { PropagateStatusAction } from './tasks/PropagateStatusAction.js';
import { PromoteIssueAction } from './tasks/PromoteIssueAction.js';
import { PromoteCardAction } from './tasks/PromoteCardAction.js';
import { ProbeProjectsAction } from './sync/ProbeProjectsAction.js';
import { PropagateTodoistDeletionsAction } from './todoist/PropagateTodoistDeletionsAction.js';
import { ReconcileProjectLifecycleAction } from './projects/ReconcileProjectLifecycleAction.js';
import { RekeyRenamedConnectionsAction } from './projects/RekeyRenamedConnectionsAction.js';
import { RelinkRenamedTodoAction } from './todoist/RelinkRenamedTodoAction.js';
import { RelocateTaskStatusAction } from './tasks/RelocateTaskStatusAction.js';
import { SyncChecklistAction } from './todos/SyncChecklistAction.js';
import { SyncGithubTasksAction } from './github/SyncGithubTasksAction.js';
import { SyncProjectAction } from './sync/SyncProjectAction.js';
import type { SyncHalfFactory } from './sync/SyncHalves.js';
import { SyncTodoistTasksAction } from './todoist/SyncTodoistTasksAction.js';
import { VerdictResolver } from './shared/VerdictResolver.js';
import { GitHubAdapter, type Transport } from './github/GitHubAdapter.js';
import { VaultAdapter } from './vault/VaultAdapter.js';
import { SyncStateAdapter } from './registry/SyncStateAdapter.js';
import { loadDataSafely } from './registry/loadDataSafely.js';
import {
  TodoistAdapter,
  createTodoistTransport,
} from './todoist/TodoistAdapter.js';
import { PromoteToTaskCommand } from './app/commands/PromoteToTaskCommand.js';
import { PromoteCardToIssueCommand } from './app/commands/PromoteCardToIssueCommand.js';

// One authenticated GitHub request. GraphQL goes over POST to /graphql; the
// REST calls pass their path. The adapter stays token-agnostic; the
// Authorization header is added here.
async function request(
  token: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await requestUrl({
    url: `https://api.github.com${path}`,
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
  return { status: response.status, json: response.json };
}

// Builds the transport the GitHub adapter talks through. The conditional read
// keeps its own shape: a 304 must come back as a response, not an error.
function createTransport(token: string): Transport {
  return {
    post: (body) => request(token, 'POST', '/graphql', body),
    get: (path) => request(token, 'GET', path),
    patch: (path, body) => request(token, 'PATCH', path, body),
    postPath: (path, body) => request(token, 'POST', path, body),
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
  };
}

// The composition seam: every action, the queue and the scheduler, built from
// the plugin's settings and adapters. Split from onload so the wiring is one
// readable block; the plugin's data loading and app-level registration stay in
// onload.
function composePlugin(
  plugin: ProjectManagementPlugin,
  syncState: SyncStateAdapter,
  secrets: SecretStore,
): {
  scheduler: SyncScheduler;
  discoverProjects: DiscoverProjectsAction;
  captureRemoteProjects: CaptureRemoteProjectsAction;
  seedArtifacts: SeedVaultArtifactsAction;
  seedTypeLabels: SeedTypeLabelsAction;
} {
  const transport = transportFromSecret(
    secrets,
    GITHUB_TOKEN_KEY,
    createTransport,
  );
  const vault = new VaultAdapter(plugin.app, (eventRef) =>
    plugin.registerEvent(eventRef),
  );
  // Seeds the six vault-owned templates and Bases files on first run. The
  // action only writes when a configured path is genuinely absent, so it is
  // safe on every init and the settings tab reuses it to scaffold on demand.
  const seedArtifacts = new SeedVaultArtifactsAction(vault, plugin.settings);

  const github = new GitHubAdapter(transport);
  // Seeds the configured type-label vocabulary onto an arbitrary repository,
  // driven by the settings tab's label-seed button.
  const seedTypeLabels = new SeedTypeLabelsAction(github);
  const createTaskNote = new CreateTaskNoteAction(
    vault,
    syncState,
    plugin.settings.taskTemplatePath,
  );
  const boardStatus = new BoardStatusAction(syncState, github);
  const propagateStatus = new PropagateStatusAction(
    github,
    syncState,
    boardStatus,
    plugin.settings.doneOptionName,
  );
  const handleDeletedNote = new HandleDeletedNoteAction(
    syncState,
    github,
    plugin.settings.doneOptionName,
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
    plugin.settings.doneOptionName,
  );
  const applyTaskToVault = new ApplyTaskToVaultAction(
    vault,
    syncState,
    createTaskNote,
    plugin.settings.taskTemplatePath,
    completeTaskCascade,
  );
  const discoverProjects = new DiscoverProjectsAction(
    vault,
    new AttachProjectAction(github),
  );
  const probeProjects = new ProbeProjectsAction(github, syncState);

  // The Todoist half of the tick: the adapter is token-bound through its
  // transport, so a missing token surfaces as a failed request, not a crash.
  const todoist = new TodoistAdapter(
    transportFromSecret(secrets, TODOIST_TOKEN_KEY, createTodoistTransport),
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
    plugin.settings.doneOptionName,
  );
  // t4: the gated Todoist writer. It absorbs the two projection actions'
  // write paths: content/section/parent/completed, writing only the fields
  // that differ. The pipeline resolves the desired shape and placement.
  const applyTaskToTodoist = new ApplyTaskToTodoistAction(todoist, syncState);
  const applyTodoistCompletion = new ApplyTodoistCompletionAction(
    vault,
    syncState,
    applyTaskToVault,
    plugin.settings.doneOptionName,
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
    plugin.settings.todoTemplatePath,
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
    plugin.settings.doneOptionName,
  );
  const captureTodoistCreations = new CaptureTodoistCreationsAction(
    vault,
    syncState,
    plugin.settings.todoTemplatePath,
    plugin.settings.doneOptionName,
  );
  // The project-propagation legs: capture remote-born projects into the
  // vault (PRJ-2/PRJ-3), then the chain's board step completes PRJ-1.
  const captureRemoteProjects = new CaptureRemoteProjectsAction(
    github,
    todoist,
    vault,
    syncState,
    plugin.settings.doneOptionName,
  );
  const ensureProjectBoard = new EnsureProjectBoardAction(
    github,
    syncState,
    plugin.settings.statusOptions,
  );

  const promoteIssue = new PromoteIssueAction(
    github,
    syncState,
    createTaskNote,
  );
  const promoteToTask = new PromoteToTaskCommand(
    () => plugin.projectNames,
    syncState,
    github,
    promoteIssue,
  );
  promoteToTask.register(plugin);

  const promoteCard = new PromoteCardAction(github, syncState, createTaskNote);
  const promoteCardToIssue = new PromoteCardToIssueCommand(
    () => plugin.projectNames,
    syncState,
    github,
    promoteCard,
  );
  promoteCardToIssue.register(plugin);

  // t4: the chain composes the rebuilt halves; the queue serialises every
  // project; the scheduler is discovery + timing policies only.
  //
  // The half factory builds ONE half per connection declared in a note, each
  // bound to its own adapter and port state. A project with two task-manager
  // connections therefore runs the task-manager half twice, once per
  // connection, with that connection's project id.
  const halfFactory: SyncHalfFactory = {
    create: (slug, connection) => {
      if (connection.tool === 'github') {
        return new SyncGithubTasksAction(
          slug,
          github,
          syncState,
          vault,
          applyTaskToGithub,
          applyTaskToVault,
          new VerdictResolver(plugin.settings.doneOptionName),
          plugin.settings.doneOptionName,
        );
      }
      if (connection.tool === 'todoist') {
        return new SyncTodoistTasksAction(
          slug,
          connection.project,
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
          plugin.settings.doneOptionName,
        );
      }
      return null;
    },
  };
  const detectNoteRenames = new DetectNoteRenamesAction(vault, syncState);
  const syncProject = new SyncProjectAction(
    vault,
    syncState,
    probeProjects,
    reconcileProjectLifecycle,
    detectNoteRenames,
    halfFactory,
    completeTaskCascade,
    syncChecklist,
    mirrorTodoStatus,
    handleDeletedNote,
    ensureProjectBoard,
    new RekeyRenamedConnectionsAction(syncState),
  );
  const queue = new SyncQueue(syncProject, (project, errors) => {
    new Notice(
      `Project "${project}": ${errors.length} sync step(s) failed; see the console`,
    );
  });
  const scheduler = new SyncScheduler(
    vault,
    queue,
    plugin.settings.pollIntervalMinutes * 60 * 1000,
    plugin.settings.debounceSeconds * 1000,
    () =>
      captureRemoteProjects
        .execute({ syncedAt: new Date().toISOString() })
        .then((result) => {
          if (result.errors.length > 0) {
            console.error('Project capture collected errors', result.errors);
          }
          return result.captured;
        }),
  );

  return {
    scheduler,
    discoverProjects,
    captureRemoteProjects,
    seedArtifacts,
    seedTypeLabels,
  };
}

export default class ProjectManagementPlugin extends Plugin {
  declare settings: ProjectManagementSettings;
  // The plugin's secret store, retained so the settings tab can read the
  // stored/not-set state and set or clear a token.
  secrets!: SecretStore;
  projectNames: string[] = [];
  // The registry adapter, retained so a settings save can share its
  // serialization chain (REG-3).
  private syncState!: SyncStateAdapter;
  // Retained so the settings tab can scaffold a single missing artifact on
  // demand, with the same create-if-missing semantics as the onload seed.
  seedArtifacts!: SeedVaultArtifactsAction;
  // Retained so the settings tab's label-seed button can apply the configured
  // type labels to an arbitrary repository.
  seedTypeLabels!: SeedTypeLabelsAction;

  override async onload(): Promise<void> {
    // Read the root through the safe loader: a corrupt data.json is quarantined
    // rather than silently reset (REG-4).
    const raw = await loadDataSafely(
      () => this.loadData(),
      () => this.quarantineDataFile(),
      () => this.dataFileExists(),
    );
    const secrets = new SecretStorageAdapter(this.app.secretStorage);
    this.secrets = secrets;
    // The registry container is stripped out of the settings merge: a stale
    // registry snapshot in settings would be written back over every registry
    // write made since onload (REG-3).
    this.settings = settingsFromData(raw);

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
    this.syncState = syncState;

    const {
      scheduler,
      discoverProjects,
      captureRemoteProjects,
      seedArtifacts,
      seedTypeLabels,
    } = composePlugin(this, syncState, this.secrets);
    this.seedArtifacts = seedArtifacts;
    this.seedTypeLabels = seedTypeLabels;
    // Seed the vault-owned templates and Bases files before any note is
    // created: a fresh vault gets all six at their configured paths, and an
    // existing file is never overwritten.
    await seedArtifacts.execute();
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
        await syncState.setIdentity(
          project.projectName,
          project.connectionSlug,
          project.identity,
        );
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
      const capture = await captureRemoteProjects.execute({
        syncedAt: new Date().toISOString(),
      });
      if (capture.errors.length > 0) {
        new Notice(
          `Project capture: ${capture.errors.length} board(s) could not be captured`,
        );
      }
    } catch (error) {
      new Notice(
        `Project discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async saveSettings(): Promise<void> {
    // Route the settings save through the adapter's serialization so it shares
    // one promise chain with every registry write: a concurrent settings save
    // and registry persist can no longer each write a stale root and lose one
    // (REG-3). The adapter hands back a FRESH data.json root (so registry writes
    // made since onload survive) and persists the merge on the shared chain.
    await this.syncState.mutateRoot((data) =>
      mergeSettingsIntoData(data, this.settings),
    );
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
