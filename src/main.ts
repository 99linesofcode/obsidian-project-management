import { Notice, Plugin, requestUrl } from 'obsidian';
import {
  mergeSettingsIntoData,
  settingsFromData,
} from './ui/settings/settings.js';
import type { ProjectManagementSettings } from './core/application/data/ProjectManagementSettings.js';
import {
  SecretStorageAdapter,
  type SecretStore,
} from './ui/settings/secret-storage/SecretStorageAdapter.js';
import { transportFromSecret } from './ui/settings/secret-storage/transportFromSecret.js';
import { ProjectManagementSettingTab } from './ui/settings/ProjectManagementSettingTab.js';
import { SeedVaultArtifactsAction } from './core/application/actions/SeedVaultArtifactsAction.js';
import { SyncScheduler } from './ui/sync/SyncScheduler.js';
import { SyncQueue } from './ui/sync/SyncQueue.js';
import { AttachProjectAction } from './core/application/actions/AttachProjectAction.js';
import type { ProjectSetupFactoryPort } from './core/port/ProjectSetupFactoryPort.js';
import type { ProjectSetupSurface } from './core/port/MirrorPort.js';
import type { RegistryPort } from './core/port/RegistryPort.js';
import { CreateTaskNoteAction } from './core/application/actions/create-task-note/CreateTaskNoteAction.js';
import type { CaptureProjectsResult } from './core/application/actions/CaptureProjectsAction.js';
import { CaptureProjectsAction } from './core/application/actions/CaptureProjectsAction.js';
import { CaptureTasksAction } from './core/application/actions/capture-tasks/CaptureTasksAction.js';
import type { CaptureSource } from './core/port/MirrorAdapterFactoryPort.js';
import { CompleteTaskCascadeAction } from './core/application/actions/CompleteTaskCascadeAction.js';
import { DetectNoteRenamesAction } from './core/application/actions/DetectNoteRenamesAction.js';
import { DiscoverProjectsAction } from './core/application/actions/DiscoverProjectsAction.js';
import { EnsureProjectBoardAction } from './core/application/actions/EnsureProjectBoardAction.js';
import { ResolveProjectBoardAction } from './core/application/actions/ResolveProjectBoardAction.js';
import { HandleDeletedNoteAction } from './core/application/actions/HandleDeletedNoteAction.js';
import { MirrorTodoStatusAction } from './core/application/actions/MirrorTodoStatusAction.js';
import { RekeyRenamedConnectionsAction } from './core/application/actions/RekeyRenamedConnectionsAction.js';
import { SyncChecklistAction } from './core/application/actions/sync-checklist/SyncChecklistAction.js';
import { SyncProjectAction } from './core/application/actions/SyncProjectAction.js';
import { VaultAdapter } from './infrastructure/vault/VaultAdapter.js';
import { SyncStateAdapter } from './infrastructure/registry/SyncStateAdapter.js';
import { loadDataSafely } from './infrastructure/registry/loadDataSafely.js';
import { createTodoistTransport } from './infrastructure/todoist/createTodoistTransport.js';
import { MirrorSyncAction } from './core/application/actions/MirrorSyncAction.js';
import { ProjectLifecycleSyncAction } from './core/application/actions/ProjectLifecycleSyncAction.js';
import type { MirrorPort } from './core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from './core/port/MirrorAdapterFactoryPort.js';
import { CodeHostMirrorAdapter } from './infrastructure/github/CodeHostMirrorAdapter.js';
import type { ProjectIdentityDataTransferObject } from './core/port/data/ProjectIdentityDataTransferObject.js';
import type { CodeHostTransport } from './infrastructure/github/CodeHostTransport.js';
import { TaskManagerMirrorAdapter } from './infrastructure/todoist/TaskManagerMirrorAdapter.js';
import type { TokenSettingRow } from './ui/settings/TokenSettingRow.js';
import { ReconcileProjectTaskLocksAction } from './core/application/actions/ReconcileProjectTaskLocksAction.js';
import { MigrateProjectHomeNoteAction } from './core/application/actions/MigrateProjectHomeNoteAction.js';
import { SweepDeletedNotesAction } from './core/application/actions/SweepDeletedNotesAction.js';

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

interface CoreComposition {
  taskFields: MirrorSyncAction;
  lifecycle: ProjectLifecycleSyncAction;
  taskLocks: ReconcileProjectTaskLocksAction;
  taskCapture: CaptureTasksAction;
  projectCapture: () => Promise<CaptureProjectsResult>;
}

function composeCoreActions(
  plugin: ProjectManagementPlugin,
  vault: VaultAdapter,
  syncState: SyncStateAdapter,
  createTaskNote: CreateTaskNoteAction,
  mirrorAdapters: MirrorAdapterFactoryPort,
): CoreComposition {
  const capture = new CaptureProjectsAction(mirrorAdapters, vault);

  return {
    taskFields: new MirrorSyncAction(vault, syncState, mirrorAdapters),
    lifecycle: new ProjectLifecycleSyncAction(vault, syncState, mirrorAdapters),
    taskLocks: new ReconcileProjectTaskLocksAction(
      vault,
      syncState,
      mirrorAdapters,
      plugin.settings.doneOptionName,
    ),
    taskCapture: new CaptureTasksAction(
      vault,
      mirrorAdapters,
      syncState,
      createTaskNote,
      (application) => application === 'github',
    ),
    projectCapture: () => capture.invoke(),
  };
}

interface ProviderEntry {
  readonly mirror: (
    target: string,
    boardIdentity: () => Promise<ProjectIdentityDataTransferObject | null>,
  ) => MirrorPort;
  readonly capture: () => MirrorPort;
  readonly setup: () => ProjectSetupSurface | null;
  readonly token: TokenSettingRow;
}

type ProviderTable = Readonly<Record<string, ProviderEntry>>;

function mirrorAdapterFactory(
  syncState: RegistryPort,
  providers: ProviderTable,
): MirrorAdapterFactoryPort {
  const captureSources = buildCaptureSources(providers);
  return {
    create: (application, target, connectionSlug, projectName) => {
      const provider = providerFor(providers, application);
      if (provider === null) {
        return null;
      }
      return provider.mirror(target, () =>
        syncState.getIdentity(projectName, connectionSlug),
      );
    },
    captureSources: () => captureSources,
  };
}

function buildCaptureSources(
  providers: ProviderTable,
): readonly CaptureSource[] {
  const sources: CaptureSource[] = [];
  for (const [application, provider] of Object.entries(providers)) {
    const adapter = provider.capture();
    if (!hasProjectCapture(adapter)) {
      continue;
    }
    sources.push({ application, capture: adapter });
  }
  return sources;
}

function hasProjectCapture(
  adapter: MirrorPort,
): adapter is MirrorPort & Required<Pick<MirrorPort, 'captureProjects'>> {
  return adapter.captureProjects !== undefined;
}

function providerFor(
  providers: ProviderTable,
  application: string,
): ProviderEntry | null {
  return providers[application] ?? null;
}

function composePlugin(
  plugin: ProjectManagementPlugin,
  syncState: SyncStateAdapter,
  secrets: SecretStore,
): {
  scheduler: SyncScheduler;
  discoverProjects: DiscoverProjectsAction;
  projectCapture: () => Promise<CaptureProjectsResult>;
  seedArtifacts: SeedVaultArtifactsAction;
  tokenSettings: readonly TokenSettingRow[];
} {
  const codeHostToken: TokenSettingRow = {
    key: 'github-token',
    label: 'GitHub token',
    description: 'Personal access token used to talk to the GitHub API.',
  };
  const taskManagerToken: TokenSettingRow = {
    key: 'todoist-token',
    label: 'Todoist token',
    description: 'Personal API token used to talk to the Todoist API.',
  };
  const codeHostTransport = transportFromSecret(
    secrets,
    codeHostToken.key,
    createCodeHostTransport,
  );
  const taskManagerTransport = transportFromSecret(
    secrets,
    taskManagerToken.key,
    createTodoistTransport,
  );
  const codeHostSetup = new CodeHostMirrorAdapter(codeHostTransport);
  const providers: ProviderTable = {
    github: {
      mirror: (target, boardIdentity) =>
        new CodeHostMirrorAdapter(
          codeHostTransport,
          target,
          boardIdentity,
          plugin.settings.statusOptions,
        ),
      capture: () => new CodeHostMirrorAdapter(codeHostTransport),
      setup: () => codeHostSetup,
      token: codeHostToken,
    },
    todoist: {
      mirror: (target) =>
        new TaskManagerMirrorAdapter(taskManagerTransport, target),
      capture: () => new TaskManagerMirrorAdapter(taskManagerTransport),
      setup: () => null,
      token: taskManagerToken,
    },
  };
  const tokenSettings = Object.values(providers).map(
    (provider) => provider.token,
  );
  const vault: VaultAdapter = new VaultAdapter(
    plugin.app,
    (eventRef) => plugin.registerEvent(eventRef),
    new Set(Object.keys(providers)),
  );
  const seedArtifacts = new SeedVaultArtifactsAction(vault, plugin.settings);

  const setupFactory: ProjectSetupFactoryPort = {
    setupFor: (application) =>
      providerFor(providers, application)?.setup() ?? null,
  };
  const mirrorAdapters = mirrorAdapterFactory(syncState, providers);
  const createTaskNote: CreateTaskNoteAction = new CreateTaskNoteAction(
    vault,
    syncState,
    plugin.settings.taskTemplatePath,
  );
  const handleDeletedNote = new HandleDeletedNoteAction(
    syncState,
    mirrorAdapters,
  );
  const completeTaskCascade = new CompleteTaskCascadeAction(
    vault,
    plugin.settings.doneOptionName,
  );
  const resolveProjectBoard = new ResolveProjectBoardAction();
  const discoverProjects = new DiscoverProjectsAction(
    vault,
    setupFactory,
    new AttachProjectAction(resolveProjectBoard),
  );

  const syncChecklist = new SyncChecklistAction(
    vault,
    plugin.settings.todoTemplatePath,
  );
  const mirrorTodoStatus = new MirrorTodoStatusAction(vault);

  const ensureProjectBoard = new EnsureProjectBoardAction(
    syncState,
    plugin.settings.statusOptions,
    resolveProjectBoard,
  );

  const detectNoteRenames = new DetectNoteRenamesAction(vault, syncState);
  const core = composeCoreActions(
    plugin,
    vault,
    syncState,
    createTaskNote,
    mirrorAdapters,
  );
  const migrateHomeNote = new MigrateProjectHomeNoteAction(vault);
  const sweepDeletedNotes = new SweepDeletedNotesAction(
    vault,
    syncState,
    handleDeletedNote,
  );
  const syncProject = new SyncProjectAction({
    vault,
    setupFactory,
    lifecycle: core.lifecycle,
    taskLocks: core.taskLocks,
    taskCapture: core.taskCapture,
    taskFields: core.taskFields,
    migrateHomeNote,
    detectNoteRenames,
    completeTaskCascade,
    syncChecklist,
    mirrorTodoStatus,
    sweepDeletedNotes,
    rekeyRenamedConnections: new RekeyRenamedConnectionsAction(syncState),
    ensureProjectBoard,
  });
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
      core.projectCapture().then((result) => {
        if (result.errors.length > 0) {
          console.error('Project capture collected errors', result.errors);
        }
        return result.captured;
      }),
  );

  return {
    scheduler,
    discoverProjects,
    projectCapture: core.projectCapture,
    seedArtifacts,
    tokenSettings,
  };
}

export default class ProjectManagementPlugin extends Plugin {
  declare settings: ProjectManagementSettings;
  secrets!: SecretStore;
  projectNames: string[] = [];
  private syncState!: SyncStateAdapter;
  seedArtifacts!: SeedVaultArtifactsAction;
  tokenSettings!: readonly TokenSettingRow[];

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

    const {
      scheduler,
      discoverProjects,
      projectCapture,
      seedArtifacts,
      tokenSettings,
    } = composePlugin(this, syncState, this.secrets);
    this.seedArtifacts = seedArtifacts;
    this.tokenSettings = tokenSettings;
    await seedArtifacts.execute();
    this.addChild(scheduler);

    this.app.workspace.onLayoutReady(() => {
      void this.discoverAndSync(discoverProjects, syncState, projectCapture);
    });

    this.addSettingTab(new ProjectManagementSettingTab(this.app, this));
  }

  private async discoverAndSync(
    discoverProjects: DiscoverProjectsAction,
    syncState: RegistryPort,
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
