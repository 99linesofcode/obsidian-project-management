import {
  archivedFromPath,
  projectNameFromFolder,
  resolveHomeNotePath,
} from '../../domain/paths.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { ProjectNoteDataTransferObject } from '../../port/data/ProjectNoteDataTransferObject.js';
import type { VaultPort } from '../../port/VaultPort.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { CaptureTasksAction } from './capture-tasks/CaptureTasksAction.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { EnsureProjectBoardAction } from './EnsureProjectBoardAction.js';
import type { MigrateNoteFilenamesAction } from './MigrateNoteFilenamesAction.js';
import type { MigrateNoteIdsAction } from './MigrateNoteIdsAction.js';
import type { MigrateProjectHomeNoteAction } from './MigrateProjectHomeNoteAction.js';
import type { MirrorSyncAction } from './MirrorSyncAction.js';
import type { MirrorTodoStatusAction } from './MirrorTodoStatusAction.js';
import type { ProjectLifecycleSyncAction } from './ProjectLifecycleSyncAction.js';
import type { ReconcileProjectTaskLocksAction } from './ReconcileProjectTaskLocksAction.js';
import type { RekeyRenamedConnectionsAction } from './RekeyRenamedConnectionsAction.js';
import type { SweepDeletedNotesAction } from './SweepDeletedNotesAction.js';
import type { SyncChecklistAction } from './sync-checklist/SyncChecklistAction.js';

export interface SyncProjectDependencies {
  vault: VaultPort;
  mirrorAdapters: MirrorAdapterFactoryPort;
  lifecycle: ProjectLifecycleSyncAction;
  taskLocks: ReconcileProjectTaskLocksAction;
  taskCapture: CaptureTasksAction;
  taskFields: MirrorSyncAction;
  migrateNoteIds: MigrateNoteIdsAction;
  migrateNoteFilenames: MigrateNoteFilenamesAction;
  migrateHomeNote: MigrateProjectHomeNoteAction;
  detectNoteRenames: DetectNoteRenamesAction;
  syncChecklist: SyncChecklistAction;
  mirrorTodoStatus: MirrorTodoStatusAction;
  sweepDeletedNotes: SweepDeletedNotesAction;
  rekeyRenamedConnections?: RekeyRenamedConnectionsAction | undefined;
  ensureProjectBoard?: EnsureProjectBoardAction | undefined;
}

export class SyncProjectAction {
  private stepErrors: unknown[] = [];

  constructor(private readonly deps: SyncProjectDependencies) {}

  async execute(folderPath: string): Promise<unknown[]> {
    this.stepErrors = [];
    const syncedAt = new Date().toISOString();
    const projectName = projectNameFromFolder(folderPath);
    if (projectName === null) {
      return this.stepErrors;
    }

    await this.step('migrate note ids', () =>
      this.deps.migrateNoteIds.execute({ projectName }),
    );

    await this.step('migrate note filenames', () =>
      this.deps.migrateNoteFilenames.execute({ projectName }),
    );

    const note = await this.resolveProject(folderPath, projectName);
    if (note === null) {
      return this.stepErrors;
    }
    const projectId = await this.resolveProjectId(note.path);
    if (projectId === null) {
      return this.stepErrors;
    }

    await this.migrateHomeNote(note);
    await this.rekey(projectId, note.connections);
    await this.ensureBoards(projectId, projectName, note.connections);

    const { frozen, wasFrozen } = await this.reconcileLifecycle(
      projectId,
      projectName,
      note,
    );

    await this.step('task locks', () =>
      this.deps.taskLocks.invoke({ projectId, frozen, wasFrozen }),
    );

    await this.renames(projectId, syncedAt);
    await this.vaultConsistency(projectId, projectName, syncedAt);

    if (!frozen) {
      await this.step('task capture', () =>
        this.deps.taskCapture.invoke({ projectId, projectName }, syncedAt),
      );
      await this.step('task fields', () =>
        this.deps.taskFields.invoke(projectId),
      );
    }

    await this.deletions(projectId, projectName, note.connections);

    return this.stepErrors;
  }

  private async migrateHomeNote(
    note: ProjectNoteDataTransferObject,
  ): Promise<void> {
    await this.step('migrate home note', () =>
      this.deps.migrateHomeNote.execute({
        projectName: note.projectName,
        notePath: note.path,
        locationArchived: archivedFromPath(note.path),
      }),
    );
  }

  private async rekey(
    projectId: string,
    connections: readonly ConnectionDataTransferObject[],
  ): Promise<void> {
    await this.step('rekey connections', async () => {
      const rekey = this.deps.rekeyRenamedConnections;
      if (rekey === undefined) {
        return;
      }
      const warnings = await rekey.execute({ projectId, connections });
      for (const warning of warnings) {
        console.warn(warning);
      }
    });
  }

  private async ensureBoards(
    projectId: string,
    projectName: string,
    connections: readonly ConnectionDataTransferObject[],
  ): Promise<void> {
    const ensureBoard = this.deps.ensureProjectBoard;
    if (ensureBoard === undefined) {
      return;
    }
    for (const connection of connections) {
      const setup = this.deps.mirrorAdapters.create(
        connection.application,
        connection.target,
        connection.slug,
        projectId,
      );
      if (setup === null) {
        continue;
      }
      await this.step(`ensure board ${connection.slug}`, () =>
        ensureBoard.execute({
          projectId,
          projectName,
          connectionSlug: connection.slug,
          target: connection.target,
          setup,
        }),
      );
    }
  }

  private async renames(projectId: string, syncedAt: string): Promise<void> {
    await this.step('renames', () =>
      this.deps.detectNoteRenames.execute({ projectId, syncedAt }),
    );
  }

  private async vaultConsistency(
    projectId: string,
    projectName: string,
    syncedAt: string,
  ): Promise<void> {
    const notePaths = await this.listNotes(projectId);

    for (const notePath of notePaths) {
      await this.step(`checklist ${notePath}`, () =>
        this.deps.syncChecklist.execute({
          notePath,
          projectName,
          syncedAt,
        }),
      );
    }

    for (const todoPath of notePaths) {
      await this.step(`mirror ${todoPath}`, () =>
        this.deps.mirrorTodoStatus.execute({ todoPath, syncedAt }),
      );
    }
  }

  private async deletions(
    projectId: string,
    projectName: string,
    connections: readonly ConnectionDataTransferObject[],
  ): Promise<void> {
    await this.step('deletions', () =>
      this.deps.sweepDeletedNotes.execute({
        projectId,
        projectName,
        connections,
      }),
    );
  }

  private async resolveProject(
    folderPath: string,
    projectName: string,
  ): Promise<ProjectNoteDataTransferObject | null> {
    const notes = await this.deps.vault.findProjectNotes();
    const candidates = notes.filter((note) =>
      note.path.startsWith(`${folderPath}/`),
    );
    const homePath = resolveHomeNotePath(
      candidates.map((note) => note.path),
      projectName,
    );
    return candidates.find((note) => note.path === homePath) ?? null;
  }

  private async resolveProjectId(notePath: string): Promise<string | null> {
    const ids = await this.deps.vault.readNoteIds();
    const id = ids.find((note) => note.path === notePath)?.id;
    if (id === undefined || id === '') {
      console.error(
        `SyncProjectAction: the home note ${notePath} carries no id; aborting the pass`,
      );
      this.stepErrors.push(
        new Error(`SyncProjectAction: the home note ${notePath} carries no id`),
      );
      return null;
    }
    return id;
  }

  private async reconcileLifecycle(
    projectId: string,
    projectName: string,
    note: ProjectNoteDataTransferObject,
  ): Promise<{ frozen: boolean; wasFrozen: boolean }> {
    try {
      return await this.deps.lifecycle.invoke({ projectId, projectName });
    } catch (error) {
      console.error(
        `SyncProjectAction: lifecycle failed for ${projectName}`,
        error,
      );
      return { frozen: archivedFromPath(note.path), wasFrozen: false };
    }
  }

  private async listNotes(projectId: string): Promise<readonly string[]> {
    try {
      return await this.deps.vault.listEntities(projectId);
    } catch (error) {
      console.error('SyncProjectAction: list taken failed', error);
      this.stepErrors.push(error);
      return [];
    }
  }

  private async step(name: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error(`SyncProjectAction: ${name} failed`, error);
      this.stepErrors.push(error);
    }
  }
}
