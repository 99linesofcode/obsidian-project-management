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
import type { ProjectSetupPort } from './core/port/ProjectSetupPort.js';
import type { IdentityStorePort } from './core/port/IdentityStorePort.js';
import { CreateTaskNoteAction } from './core/application/actions/create-task-note/CreateTaskNoteAction.js';
import type { CaptureProjectsResult } from './core/application/actions/CaptureProjectsAction.js';
import { CaptureProjectsAction } from './core/application/actions/CaptureProjectsAction.js';
import { CaptureTasksAction } from './core/application/actions/CaptureTasksAction.js';
import { VaultProjectCaptureAdapter } from './infrastructure/vault/VaultProjectCaptureAdapter.js';
import { VaultTaskCaptureAdapter } from './infrastructure/vault/VaultTaskCaptureAdapter.js';
import { RegistryProjectCursorAdapter } from './infrastructure/registry/RegistryProjectCursorAdapter.js';
import type { CaptureSource } from './core/port/MirrorAdapterFactoryPort.js';
import { CompleteTaskCascadeAction } from './core/application/actions/CompleteTaskCascadeAction.js';
import { DetectNoteRenamesAction } from './core/application/actions/DetectNoteRenamesAction.js';
import { DiscoverProjectsAction } from './core/application/actions/DiscoverProjectsAction.js';
import { EnsureProjectBoardAction } from './core/application/actions/EnsureProjectBoardAction.js';
import { HandleDeletedNoteAction } from './core/application/actions/HandleDeletedNoteAction.js';
import { MirrorTodoStatusAction } from './core/application/actions/MirrorTodoStatusAction.js';
import { RekeyRenamedConnectionsAction } from './core/application/actions/RekeyRenamedConnectionsAction.js';
import { SyncChecklistAction } from './core/application/actions/sync-checklist/SyncChecklistAction.js';
import { SyncProjectAction } from './core/application/actions/SyncProjectAction.js';
import { VaultAdapter } from './infrastructure/vault/VaultAdapter.js';
import { SyncStateAdapter } from './infrastructure/registry/SyncStateAdapter.js';
import { loadDataSafely } from './infrastructure/registry/loadDataSafely.js';
import { createTodoistTransport } from './infrastructure/todoist/TodoistTransport.js';
import { AdapterRegistration } from './core/application/data/AdapterRegistration.js';
import type { RegistrationResult } from './core/application/data/RegistrationResult.js';
import { registerAdapters } from './core/domain/registerAdapters.js';
import { ConformanceMirrorAdapter } from './infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from './infrastructure/fake/conformanceDescriptor.js';
import { AssembleProjectPassAction } from './core/application/actions/AssembleProjectPassAction.js';
import { AssembleProjectLifecyclePassAction } from './core/application/actions/AssembleProjectLifecyclePassAction.js';
import type { AdapterDescriptor } from './core/application/data/AdapterDescriptor.js';
import type { RegisteredAdapter } from './core/application/data/RegisteredAdapter.js';
import type { MirrorAdapter } from './core/port/MirrorAdapter.js';
import type { MirrorAdapterFactoryPort } from './core/port/MirrorAdapterFactoryPort.js';
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
import { todoistDescriptor } from './infrastructure/todoist/todoistDescriptor.js';
import { ReconcileProjectTaskLocksAction } from './core/application/actions/ReconcileProjectTaskLocksAction.js';
import { ReactivateFrozenProjectAction } from './core/application/actions/ReactivateFrozenProjectAction.js';
import { CoreProjectWatchAdapter } from './infrastructure/registry/CoreProjectWatchAdapter.js';
import type { CoreReconcilers } from './core/application/services/CoreReconcilers.js';
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

interface CoreComposition {
  reconcilers: CoreReconcilers;
  projectCapture: () => Promise<CaptureProjectsResult>;
}

function composeCoreReconcilers(
  plugin: ProjectManagementPlugin,
  vault: VaultAdapter,
  syncState: SyncStateAdapter,
  baselineStorage: CoreBaselineStorage,
  createTaskNote: CreateTaskNoteAction,
  mirrorAdapters: MirrorAdapterFactoryPort,
): CoreComposition {
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
    reconcilers: {
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
      taskCapture: {
        capture: async (project, syncedAt) => {
          await captureTasks.invoke(project, syncedAt);
        },
      },
    },
    projectCapture: () => capture.invoke(new Date().toISOString()),
  };
}

interface Provider {
  applicationId: string;
  descriptor: AdapterDescriptor;
  mirror: (
    target: string,
    boardIdentity: () => Promise<BoardIdentity | null>,
  ) => MirrorAdapter;
  capture: () => MirrorAdapter;
  setup: () => ProjectSetupPort | null;
}

function mirrorAdapterFactory(
  syncState: IdentityStorePort,
  providers: readonly Provider[],
): MirrorAdapterFactoryPort {
  const captureSources = buildCaptureSources(providers);
  return {
    create: (application, target, connectionSlug, projectName) => {
      const provider = providerFor(providers, application);
      if (provider === null) {
        return null;
      }
      return gateMirror(
        provider.descriptor,
        provider.mirror(target, () =>
          syncState.getIdentity(projectName, connectionSlug),
        ),
      );
    },
    captureSources: () => captureSources,
  };
}

function buildCaptureSources(
  providers: readonly Provider[],
): readonly CaptureSource[] {
  const sources: CaptureSource[] = [];
  for (const provider of providers) {
    const registered = gateMirror(provider.descriptor, provider.capture());
    const capture = registered?.projectCapture;
    if (capture !== undefined) {
      sources.push({ application: provider.applicationId, capture });
    }
  }
  return sources;
}

function providerFor(
  providers: readonly Provider[],
  application: string,
): Provider | null {
  return (
    providers.find((provider) => provider.applicationId === application) ?? null
  );
}

function secretKeyOf(descriptor: AdapterDescriptor): string {
  const key = descriptor.secretKeys[0];
  if (key === undefined) {
    throw new Error(
      `descriptor '${descriptor.applicationId}' declares no secret key`,
    );
  }
  return key;
}

function registeredApplicationIds(
  descriptors: readonly AdapterDescriptor[],
  conformance: AdapterDescriptor,
): ReadonlySet<string> {
  return new Set(
    [...descriptors, conformance].map((descriptor) => descriptor.applicationId),
  );
}

function gateMirror(
  descriptor: AdapterDescriptor,
  adapter: MirrorAdapter,
): RegisteredAdapter | null {
  return (
    registerAdapters([
      new AdapterRegistration(descriptor, adapter),
    ]).adapters.get(descriptor.applicationId) ?? null
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
  providerDescriptors: readonly AdapterDescriptor[];
} {
  const conformance = conformanceDescriptor('conformance');
  const codeHostDescriptor = githubDescriptor();
  const taskManagerDescriptor = todoistDescriptor();
  const codeHostTransport = transportFromSecret(
    secrets,
    secretKeyOf(codeHostDescriptor),
    createCodeHostTransport,
  );
  const taskManagerTransport = transportFromSecret(
    secrets,
    secretKeyOf(taskManagerDescriptor),
    createTodoistTransport,
  );
  const codeHostSetup = new CodeHostMirrorAdapter(codeHostTransport);
  const providers: Provider[] = [
    {
      applicationId: 'github',
      descriptor: codeHostDescriptor,
      mirror: (target, boardIdentity) =>
        new CodeHostMirrorAdapter(
          codeHostTransport,
          target,
          boardIdentity,
          plugin.settings.statusOptions,
        ),
      capture: () => new CodeHostMirrorAdapter(codeHostTransport),
      setup: () => codeHostSetup,
    },
    {
      applicationId: 'todoist',
      descriptor: taskManagerDescriptor,
      mirror: (target) =>
        new TaskManagerMirrorAdapter(taskManagerTransport, target),
      capture: () => new TaskManagerMirrorAdapter(taskManagerTransport),
      setup: () => null,
    },
  ];
  const providerDescriptors = providers.map((provider) => provider.descriptor);
  const vault = new VaultAdapter(
    plugin.app,
    (eventRef) => plugin.registerEvent(eventRef),
    registeredApplicationIds(providerDescriptors, conformance),
  );
  const seedArtifacts = new SeedVaultArtifactsAction(vault, plugin.settings);

  const setupFactory: ProjectSetupFactoryPort = {
    setupFor: (application) =>
      providerFor(providers, application)?.setup() ?? null,
  };
  const mirrorAdapters = mirrorAdapterFactory(syncState, providers);
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
  const { reconcilers, projectCapture } = composeCoreReconcilers(
    plugin,
    vault,
    syncState,
    baselineStorage,
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
    reconcilers,
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
    providerDescriptors,
  };
}

export default class ProjectManagementPlugin extends Plugin {
  declare settings: ProjectManagementSettings;
  secrets!: SecretStore;
  projectNames: string[] = [];
  private syncState!: SyncStateAdapter;
  seedArtifacts!: SeedVaultArtifactsAction;
  adapters!: RegistrationResult;
  providerDescriptors!: readonly AdapterDescriptor[];

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
      providerDescriptors,
    } = composePlugin(this, syncState, this.secrets, baselineStorage);
    this.seedArtifacts = seedArtifacts;
    this.adapters = adapters;
    this.providerDescriptors = providerDescriptors;
    await seedArtifacts.execute();
    this.addChild(scheduler);

    this.app.workspace.onLayoutReady(() => {
      void this.discoverAndSync(discoverProjects, syncState, projectCapture);
    });

    this.addSettingTab(new ProjectManagementSettingTab(this.app, this));
  }

  private async discoverAndSync(
    discoverProjects: DiscoverProjectsAction,
    syncState: IdentityStorePort,
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
