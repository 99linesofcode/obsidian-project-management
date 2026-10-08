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
import { AdapterRegistration } from './core/data/AdapterRegistration.js';
import type { RegistrationResult } from './core/data/RegistrationResult.js';
import { registerAdapters } from './core/registerAdapters.js';
import { ConformanceMirrorAdapter } from './infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from './infrastructure/fake/conformanceDescriptor.js';
import { AssembleProjectPassAction } from './core/AssembleProjectPassAction.js';
import { AssembleProjectLifecyclePassAction } from './core/AssembleProjectLifecyclePassAction.js';
import type { AdapterDescriptor } from './core/AdapterDescriptor.js';
import type { RegisteredAdapter } from './core/data/RegisteredAdapter.js';
import type { MirrorAdapter } from './core/ports/MirrorAdapter.js';
import type { MirrorAdapterFactoryPort } from './core/ports/MirrorAdapterFactoryPort.js';
import {
  CoreBaselineStoreAdapter,
  type CoreBaselineStorage,
} from './infrastructure/registry/CoreBaselineStoreAdapter.js';
import { RegistryMirrorHandleAdapter } from './infrastructure/registry/RegistryMirrorHandleAdapter.js';
import { VaultOriginAdapter } from './infrastructure/vault/VaultOriginAdapter.js';
import { VaultProjectLifecycleAdapter } from './infrastructure/vault/VaultProjectLifecycleAdapter.js';
import { VaultProjectSourceAdapter } from './infrastructure/vault/VaultProjectSourceAdapter.js';
import {
  CodeHostMirrorAdapter,
  type BoardIdentity,
} from './infrastructure/github/CodeHostMirrorAdapter.js';
import type { CodeHostTransport } from './infrastructure/github/CodeHostTransport.js';
import { githubDescriptor } from './infrastructure/github/githubDescriptor.js';
import { TaskManagerMirrorAdapter } from './infrastructure/todoist/TaskManagerMirrorAdapter.js';
import type { TaskManagerTransport } from './infrastructure/todoist/TaskManagerTransport.js';
import { todoistDescriptor } from './infrastructure/todoist/todoistDescriptor.js';
import type { TaskFieldReconciler } from './sync/TaskFieldReconciler.js';
import type { ProjectLifecycleReconciler } from './sync/ProjectLifecycleReconciler.js';

async function request(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
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

function createCodeHostTransport(token: string): CodeHostTransport {
  return {
    post: (body) => request(token, 'POST', '/graphql', body),
    get: (path) => request(token, 'GET', path),
    patch: (path, body) => request(token, 'PATCH', path, body),
    postPath: (path, body) => request(token, 'POST', path, body),
    putPath: (path, body) => request(token, 'PUT', path, body),
  };
}

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

function composeTaskFieldReconciler(
  plugin: ProjectManagementPlugin,
  vault: VaultAdapter,
  syncState: SyncStateAdapter,
  secrets: SecretStore,
  baselineStorage: CoreBaselineStorage,
): TaskFieldReconciler {
  const codeHostTransport = createCodeHostTransport(
    secrets.load(GITHUB_TOKEN_KEY) ?? '',
  );
  const taskManagerTransport = transportFromSecret(
    secrets,
    TODOIST_TOKEN_KEY,
    createTodoistTransport,
  );
  const assemblePass = new AssembleProjectPassAction(
    new VaultProjectSourceAdapter(vault),
    new VaultOriginAdapter(plugin.app),
    new CoreBaselineStoreAdapter(baselineStorage),
    new RegistryMirrorHandleAdapter(syncState),
    mirrorAdapterFactory(syncState, codeHostTransport, taskManagerTransport),
  );

  return {
    reconcile: async (project) => {
      await assemblePass.invoke(project);
    },
  };
}

function composeProjectLifecycleReconciler(
  vault: VaultAdapter,
  syncState: SyncStateAdapter,
  secrets: SecretStore,
  baselineStorage: CoreBaselineStorage,
): ProjectLifecycleReconciler {
  const codeHostTransport = createCodeHostTransport(
    secrets.load(GITHUB_TOKEN_KEY) ?? '',
  );
  const taskManagerTransport = transportFromSecret(
    secrets,
    TODOIST_TOKEN_KEY,
    createTodoistTransport,
  );
  const assemblePass = new AssembleProjectLifecyclePassAction(
    new VaultProjectSourceAdapter(vault),
    new VaultProjectLifecycleAdapter(vault, syncState),
    new CoreBaselineStoreAdapter(baselineStorage),
    mirrorAdapterFactory(syncState, codeHostTransport, taskManagerTransport),
  );

  return {
    reconcile: async (project) => ({
      frozen: (await assemblePass.invoke(project)).frozen,
    }),
  };
}

function mirrorAdapterFactory(
  syncState: SyncStateAdapter,
  codeHost: CodeHostTransport,
  taskManager: TaskManagerTransport,
): MirrorAdapterFactoryPort {
  return {
    create: (application, target, connectionSlug, projectName) =>
      createMirrorAdapter(
        application,
        target,
        () => syncState.getIdentity(projectName, connectionSlug),
        codeHost,
        taskManager,
      ),
  };
}

function createMirrorAdapter(
  application: string,
  target: string,
  boardIdentity: () => Promise<BoardIdentity | null>,
  codeHost: CodeHostTransport,
  taskManager: TaskManagerTransport,
): RegisteredAdapter | null {
  if (application === 'github') {
    return gateMirror(
      githubDescriptor(),
      new CodeHostMirrorAdapter(codeHost, target, boardIdentity),
    );
  }
  if (application === 'todoist') {
    return gateMirror(
      todoistDescriptor(),
      new TaskManagerMirrorAdapter(taskManager, target),
    );
  }
  return null;
}

function gateMirror(
  descriptor: AdapterDescriptor,
  adapter: MirrorAdapter,
): RegisteredAdapter | null {
  return (
    registerAdapters([new AdapterRegistration(descriptor, adapter)]).adapters.get(
      descriptor.applicationId,
    ) ?? null
  );
}

function composePlugin(
  plugin: ProjectManagementPlugin,
  syncState: SyncStateAdapter,
  secrets: SecretStore,
  baselineStorage: CoreBaselineStorage,
): {
  scheduler: SyncScheduler;
  discoverProjects: DiscoverProjectsAction;
  captureRemoteProjects: CaptureRemoteProjectsAction;
  seedArtifacts: SeedVaultArtifactsAction;
  seedTypeLabels: SeedTypeLabelsAction;
  adapters: RegistrationResult;
} {
  const transport = transportFromSecret(
    secrets,
    GITHUB_TOKEN_KEY,
    createTransport,
  );
  const vault = new VaultAdapter(plugin.app, (eventRef) =>
    plugin.registerEvent(eventRef),
  );
  const seedArtifacts = new SeedVaultArtifactsAction(vault, plugin.settings);

  const github = new GitHubAdapter(transport);
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
  const applyTaskToGithub = new ApplyTaskToGithubAction(github, syncState);
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

  const todoist = new TodoistAdapter(
    transportFromSecret(secrets, TODOIST_TOKEN_KEY, createTodoistTransport),
  );
  const reconcileProjectLifecycle = new ReconcileProjectLifecycleAction(
    github,
    todoist,
    vault,
    syncState,
    plugin.settings.doneOptionName,
  );
  const applyTaskToTodoist = new ApplyTaskToTodoistAction(todoist, syncState);
  const applyTodoistCompletion = new ApplyTodoistCompletionAction(
    vault,
    syncState,
    applyTaskToVault,
    plugin.settings.doneOptionName,
  );
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
  let composedTaskFieldReconciler: TaskFieldReconciler | undefined;
  const taskFieldReconciler = (): TaskFieldReconciler | undefined => {
    if (!plugin.settings.multiAdapterEngine) {
      return undefined;
    }
    composedTaskFieldReconciler ??= composeTaskFieldReconciler(
      plugin,
      vault,
      syncState,
      secrets,
      baselineStorage,
    );
    return composedTaskFieldReconciler;
  };
  let composedProjectLifecycleReconciler: ProjectLifecycleReconciler | undefined;
  const projectLifecycleReconciler = ():
    | ProjectLifecycleReconciler
    | undefined => {
    if (!plugin.settings.multiAdapterEngine) {
      return undefined;
    }
    composedProjectLifecycleReconciler ??= composeProjectLifecycleReconciler(
      vault,
      syncState,
      secrets,
      baselineStorage,
    );
    return composedProjectLifecycleReconciler;
  };
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
    taskFieldReconciler,
    projectLifecycleReconciler,
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
    adapters: registerAdapters([
      new AdapterRegistration(
        conformanceDescriptor('conformance'),
        new ConformanceMirrorAdapter(),
      ),
    ]),
  };
}

export default class ProjectManagementPlugin extends Plugin {
  declare settings: ProjectManagementSettings;
  secrets!: SecretStore;
  projectNames: string[] = [];
  private syncState!: SyncStateAdapter;
  seedArtifacts!: SeedVaultArtifactsAction;
  seedTypeLabels!: SeedTypeLabelsAction;
  adapters!: RegistrationResult;

  override async onload(): Promise<void> {
    const raw = await loadDataSafely(
      () => this.loadData(),
      () => this.quarantineDataFile(),
      () => this.dataFileExists(),
    );
    const secrets = new SecretStorageAdapter(this.app.secretStorage);
    this.secrets = secrets;
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

    const baselineStorage: CoreBaselineStorage = {
      load: () =>
        loadDataSafely(
          () => this.loadData(),
          () => this.quarantineDataFile(),
          () => this.dataFileExists(),
        ),
      save: (data) => this.saveData(data),
    };

    const {
      scheduler,
      discoverProjects,
      captureRemoteProjects,
      seedArtifacts,
      seedTypeLabels,
      adapters,
    } = composePlugin(this, syncState, this.secrets, baselineStorage);
    this.seedArtifacts = seedArtifacts;
    this.seedTypeLabels = seedTypeLabels;
    this.adapters = adapters;
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
    await this.syncState.mutateRoot((data) =>
      mergeSettingsIntoData(data, this.settings),
    );
  }

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

  private dataFilePath(): string | null {
    const dir = this.manifest.dir;
    return dir === undefined ? null : `${dir}/data.json`;
  }
}
