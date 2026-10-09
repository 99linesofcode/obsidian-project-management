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
import { SyncScheduler } from './app/SyncScheduler.js';
import { SyncQueue } from './app/SyncQueue.js';
import { AttachProjectAction } from './projects/AttachProjectAction.js';
import type { ProjectSetupFactoryPort } from './core/ports/ProjectSetupFactoryPort.js';
import { CreateTaskNoteAction } from './tasks/CreateTaskNoteAction.js';
import type { CaptureProjectsResult } from './core/CaptureProjectsAction.js';
import { CaptureProjectsAction } from './core/CaptureProjectsAction.js';
import { CaptureTasksAction } from './core/CaptureTasksAction.js';
import { VaultProjectCaptureAdapter } from './infrastructure/vault/VaultProjectCaptureAdapter.js';
import { VaultTaskCaptureAdapter } from './infrastructure/vault/VaultTaskCaptureAdapter.js';
import { RegistryProjectCursorAdapter } from './infrastructure/registry/RegistryProjectCursorAdapter.js';
import type { CaptureSource } from './core/ports/MirrorAdapterFactoryPort.js';
import { CompleteTaskCascadeAction } from './tasks/CompleteTaskCascadeAction.js';
import { DetectNoteRenamesAction } from './sync/DetectNoteRenamesAction.js';
import { DiscoverProjectsAction } from './projects/DiscoverProjectsAction.js';
import { EnsureProjectBoardAction } from './projects/EnsureProjectBoardAction.js';
import { HandleDeletedNoteAction } from './sync/HandleDeletedNoteAction.js';
import { MirrorTodoStatusAction } from './todos/MirrorTodoStatusAction.js';
import { ProbeProjectsAction } from './sync/ProbeProjectsAction.js';
import { RekeyRenamedConnectionsAction } from './projects/RekeyRenamedConnectionsAction.js';
import { SyncChecklistAction } from './todos/SyncChecklistAction.js';
import { SyncProjectAction } from './sync/SyncProjectAction.js';
import { VaultAdapter } from './vault/VaultAdapter.js';
import { SyncStateAdapter } from './registry/SyncStateAdapter.js';
import { loadDataSafely } from './registry/loadDataSafely.js';
import { createTodoistTransport } from './infrastructure/todoist/TodoistTransport.js';
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
import { RegistryMirrorProjectAdapter } from './infrastructure/registry/RegistryMirrorProjectAdapter.js';
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
import type { TaskCaptureReconciler } from './sync/TaskCaptureReconciler.js';
import type { ProjectLifecycleReconciler } from './sync/ProjectLifecycleReconciler.js';
import type { ProjectTaskLocksReconciler } from './sync/ProjectTaskLocksReconciler.js';
import type { ProjectReactivationReconciler } from './sync/ProjectReactivationReconciler.js';
import { ReconcileProjectTaskLocksAction } from './core/ReconcileProjectTaskLocksAction.js';
import { ReactivateFrozenProjectAction } from './core/ReactivateFrozenProjectAction.js';
import { CoreProjectWatchAdapter } from './infrastructure/registry/CoreProjectWatchAdapter.js';

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
    patch: (path, body) => request(token, 'PATCH', path, body),
    postPath: (path, body) => request(token, 'POST', path, body),
    putPath: (path, body) => request(token, 'PUT', path, body),
  };
}

interface ProjectCaptureReconciler {
  capture(syncedAt: string): Promise<CaptureProjectsResult>;
}

interface CoreReconcilers {
  taskFields: TaskFieldReconciler;
  lifecycle: ProjectLifecycleReconciler;
  taskLocks: ProjectTaskLocksReconciler;
  reactivation: ProjectReactivationReconciler;
  capture: ProjectCaptureReconciler;
  taskCapture: TaskCaptureReconciler;
}

function composeCoreReconcilers(
  plugin: ProjectManagementPlugin,
  vault: VaultAdapter,
  syncState: SyncStateAdapter,
  baselineStorage: CoreBaselineStorage,
  createTaskNote: CreateTaskNoteAction,
  mirrorAdapters: MirrorAdapterFactoryPort,
): CoreReconcilers {
  const projectSource = new VaultProjectSourceAdapter(vault);
  const baselines = new CoreBaselineStoreAdapter(baselineStorage);

  const origin = new VaultOriginAdapter(plugin.app);
  const handles = new RegistryMirrorHandleAdapter(syncState);
  const taskFieldPass = new AssembleProjectPassAction(
    projectSource,
    origin,
    baselines,
    handles,
    mirrorAdapters,
  );
  const lifecycleOrigin = new VaultProjectLifecycleAdapter(vault, syncState);
  const lifecyclePass = new AssembleProjectLifecyclePassAction(
    projectSource,
    lifecycleOrigin,
    baselines,
    mirrorAdapters,
    new RegistryMirrorProjectAdapter(syncState),
  );
  const taskLocks = new ReconcileProjectTaskLocksAction(
    projectSource,
    origin,
    handles,
    mirrorAdapters,
    plugin.settings.doneOptionName,
  );
  const reactivation = new ReactivateFrozenProjectAction(
    projectSource,
    lifecycleOrigin,
    baselines,
    mirrorAdapters,
    new CoreProjectWatchAdapter(baselineStorage),
  );

  const capture = new CaptureProjectsAction(
    mirrorAdapters,
    new VaultProjectCaptureAdapter(vault),
    new RegistryProjectCursorAdapter(syncState),
  );
  const captureTasks = new CaptureTasksAction(
    projectSource,
    mirrorAdapters,
    new VaultTaskCaptureAdapter(
      vault,
      syncState,
      createTaskNote,
      (application) => application === 'github',
    ),
  );

  return {
    taskFields: {
      reconcile: async (project) => {
        await taskFieldPass.invoke(project);
      },
    },
    lifecycle: {
      reconcile: async (project) => {
        const record = await lifecyclePass.invoke(project);
        return { frozen: record.frozen, wasFrozen: record.wasFrozen };
      },
    },
    taskLocks: {
      reconcile: (input) => taskLocks.invoke(input),
    },
    reactivation: {
      reactivate: (project) => reactivation.invoke(project),
    },
    capture: {
      capture: (syncedAt) => capture.invoke(syncedAt),
    },
    taskCapture: {
      capture: async (project, syncedAt) => {
        await captureTasks.invoke(project, syncedAt);
      },
    },
  };
}

function mirrorAdapterFactory(
  syncState: SyncStateAdapter,
  codeHost: CodeHostTransport,
  taskManager: TaskManagerTransport,
  statusOptions: readonly string[],
): MirrorAdapterFactoryPort {
  const captureSources = buildCaptureSources(codeHost, taskManager);
  return {
    create: (application, target, connectionSlug, projectName) =>
      createMirrorAdapter(
        application,
        target,
        () => syncState.getIdentity(projectName, connectionSlug),
        codeHost,
        taskManager,
        statusOptions,
      ),
    captureSources: () => captureSources,
  };
}

function buildCaptureSources(
  codeHost: CodeHostTransport,
  taskManager: TaskManagerTransport,
): readonly CaptureSource[] {
  const sources: CaptureSource[] = [];
  const registrations: Array<[string, AdapterDescriptor, MirrorAdapter]> = [
    ['todoist', todoistDescriptor(), new TaskManagerMirrorAdapter(taskManager)],
    ['github', githubDescriptor(), new CodeHostMirrorAdapter(codeHost)],
  ];
  for (const [application, descriptor, adapter] of registrations) {
    const registered = gateMirror(descriptor, adapter);
    const capture = registered?.projectCapture;
    if (capture !== undefined) {
      sources.push({ application, capture });
    }
  }
  return sources;
}

function registeredApplicationIds(
  conformance: AdapterDescriptor,
): ReadonlySet<string> {
  return new Set(
    [githubDescriptor(), todoistDescriptor(), conformance].map(
      (descriptor) => descriptor.applicationId,
    ),
  );
}

function createMirrorAdapter(
  application: string,
  target: string,
  boardIdentity: () => Promise<BoardIdentity | null>,
  codeHost: CodeHostTransport,
  taskManager: TaskManagerTransport,
  statusOptions: readonly string[],
): RegisteredAdapter | null {
  if (application === 'github') {
    return gateMirror(
      githubDescriptor(),
      new CodeHostMirrorAdapter(codeHost, target, boardIdentity, statusOptions),
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
  projectCapture: () => Promise<CaptureProjectsResult>;
  seedArtifacts: SeedVaultArtifactsAction;
  adapters: RegistrationResult;
} {
  const conformance = conformanceDescriptor('conformance');
  const vault = new VaultAdapter(
    plugin.app,
    (eventRef) => plugin.registerEvent(eventRef),
    registeredApplicationIds(conformance),
  );
  const seedArtifacts = new SeedVaultArtifactsAction(vault, plugin.settings);

  const codeHostTransport = createCodeHostTransport(
    secrets.load(GITHUB_TOKEN_KEY) ?? '',
  );
  const codeHostSetup = new CodeHostMirrorAdapter(codeHostTransport);
  const setupFactory: ProjectSetupFactoryPort = {
    setupFor: (application) => (application === 'github' ? codeHostSetup : null),
  };
  const mirrorAdapters = mirrorAdapterFactory(
    syncState,
    codeHostTransport,
    transportFromSecret(secrets, TODOIST_TOKEN_KEY, createTodoistTransport),
    plugin.settings.statusOptions,
  );
  const createTaskNote = new CreateTaskNoteAction(
    vault,
    syncState,
    plugin.settings.taskTemplatePath,
  );
  const handleDeletedNote = new HandleDeletedNoteAction(
    syncState,
    mirrorAdapters,
    plugin.settings.doneOptionName,
  );
  const completeTaskCascade = new CompleteTaskCascadeAction(
    vault,
    plugin.settings.doneOptionName,
  );
  const discoverProjects = new DiscoverProjectsAction(
    vault,
    setupFactory,
    new AttachProjectAction(),
  );
  const probeProjects = new ProbeProjectsAction(setupFactory, syncState);

  const syncChecklist = new SyncChecklistAction(
    vault,
    plugin.settings.todoTemplatePath,
  );
  const mirrorTodoStatus = new MirrorTodoStatusAction(vault);

  const ensureProjectBoard = new EnsureProjectBoardAction(
    syncState,
    plugin.settings.statusOptions,
  );

  const detectNoteRenames = new DetectNoteRenamesAction(vault, syncState);
  let composedCoreReconcilers: CoreReconcilers | undefined;
  const coreReconcilers = (): CoreReconcilers => {
    composedCoreReconcilers ??= composeCoreReconcilers(
      plugin,
      vault,
      syncState,
      baselineStorage,
      createTaskNote,
      mirrorAdapters,
    );
    return composedCoreReconcilers;
  };
  const taskFieldReconciler = (): TaskFieldReconciler =>
    coreReconcilers().taskFields;
  const projectLifecycleReconciler = (): ProjectLifecycleReconciler =>
    coreReconcilers().lifecycle;
  const taskCaptureReconciler = (): TaskCaptureReconciler =>
    coreReconcilers().taskCapture;
  const projectTaskLocksReconciler = (): ProjectTaskLocksReconciler =>
    coreReconcilers().taskLocks;
  const projectReactivationReconciler = (): ProjectReactivationReconciler =>
    coreReconcilers().reactivation;
  const syncProject = new SyncProjectAction(
    vault,
    setupFactory,
    syncState,
    probeProjects,
    detectNoteRenames,
    completeTaskCascade,
    syncChecklist,
    mirrorTodoStatus,
    handleDeletedNote,
    taskFieldReconciler,
    projectLifecycleReconciler,
    taskCaptureReconciler,
    projectTaskLocksReconciler,
    projectReactivationReconciler,
    ensureProjectBoard,
    new RekeyRenamedConnectionsAction(syncState),
  );
  const queue = new SyncQueue(syncProject, (project, errors) => {
    new Notice(
      `Project "${project}": ${errors.length} sync step(s) failed; see the console`,
    );
  });
  const projectCapture = (): Promise<CaptureProjectsResult> =>
    coreReconcilers().capture.capture(new Date().toISOString());
  const scheduler = new SyncScheduler(
    vault,
    queue,
    plugin.settings.pollIntervalMinutes * 60 * 1000,
    plugin.settings.debounceSeconds * 1000,
    () =>
      projectCapture().then((result) => {
        if (result.errors.length > 0) {
          console.error('Project capture collected errors', result.errors);
        }
        return result.captured;
      }),
  );

  return {
    scheduler,
    discoverProjects,
    projectCapture,
    seedArtifacts,
    adapters: registerAdapters([
      new AdapterRegistration(conformance, new ConformanceMirrorAdapter()),
    ]),
  };
}

export default class ProjectManagementPlugin extends Plugin {
  declare settings: ProjectManagementSettings;
  secrets!: SecretStore;
  projectNames: string[] = [];
  private syncState!: SyncStateAdapter;
  seedArtifacts!: SeedVaultArtifactsAction;
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
      projectCapture,
      seedArtifacts,
      adapters,
    } = composePlugin(this, syncState, this.secrets, baselineStorage);
    this.seedArtifacts = seedArtifacts;
    this.adapters = adapters;
    await seedArtifacts.execute();
    this.addChild(scheduler);

    this.app.workspace.onLayoutReady(() => {
      void this.discoverAndSync(discoverProjects, syncState, projectCapture);
    });

    this.addSettingTab(new ProjectManagementSettingTab(this.app, this));
  }

  private async discoverAndSync(
    discoverProjects: DiscoverProjectsAction,
    syncState: SyncStateAdapter,
    projectCapture: () => Promise<CaptureProjectsResult>,
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
      const capture = await projectCapture();
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
