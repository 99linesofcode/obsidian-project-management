import { archivedFromPath } from '../../domain/paths.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { ProjectNoteDataTransferObject } from '../../port/data/ProjectNoteDataTransferObject.js';
import type { VaultPort } from '../../port/VaultPort.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { CaptureTasksAction } from './capture-tasks/CaptureTasksAction.js';
import type { CompleteTaskCascadeAction } from './CompleteTaskCascadeAction.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { EnsureProjectBoardAction } from './EnsureProjectBoardAction.js';
import type { MigrateProjectHomeNoteAction } from './MigrateProjectHomeNoteAction.js';
import type { MirrorSyncAction } from './MirrorSyncAction.js';
import type { MirrorTodoStatusAction } from './MirrorTodoStatusAction.js';
import type { ProjectLifecycleSyncAction } from './ProjectLifecycleSyncAction.js';
import type { ReconcileProjectTaskLocksAction } from './ReconcileProjectTaskLocksAction.js';
import type { RekeyRenamedConnectionsAction } from './RekeyRenamedConnectionsAction.js';
import type { RenameProjectAction } from './RenameProjectAction.js';
import type { SweepDeletedNotesAction } from './SweepDeletedNotesAction.js';
import type { SyncChecklistAction } from './sync-checklist/SyncChecklistAction.js';

export interface SyncProjectDependencies {
  vault: VaultPort;
  mirrorAdapters: MirrorAdapterFactoryPort;
  lifecycle: ProjectLifecycleSyncAction;
  taskLocks: ReconcileProjectTaskLocksAction;
  taskCapture: CaptureTasksAction;
  taskFields: MirrorSyncAction;
  migrateHomeNote: MigrateProjectHomeNoteAction;
  renameProject: RenameProjectAction;
  detectNoteRenames: DetectNoteRenamesAction;
  completeTaskCascade: CompleteTaskCascadeAction;
  syncChecklist: SyncChecklistAction;
  mirrorTodoStatus: MirrorTodoStatusAction;
  sweepDeletedNotes: SweepDeletedNotesAction;
  rekeyRenamedConnections?: RekeyRenamedConnectionsAction | undefined;
  ensureProjectBoard?: EnsureProjectBoardAction | undefined;
}

export class SyncProjectAction {
  private stepErrors: unknown[] = [];

  constructor(private readonly deps: SyncProjectDependencies) {}

  async execute(project: string): Promise<unknown[]> {
    this.stepErrors = [];
    const syncedAt = new Date().toISOString();

    const note = await this.resolveProject(project);
    if (note === null) {
      return this.stepErrors;
    }

    await this.migrate(project, note);
    await this.renameProject(project, note);
    await this.rekey(project, note.connections);
    await this.ensureBoards(project, note);

    const { frozen, wasFrozen } = await this.reconcileLifecycle(project, note);

    await this.step('task locks', () =>
      this.deps.taskLocks.invoke({ project, frozen, wasFrozen }),
    );

    await this.renames(project, syncedAt);
    await this.vaultConsistency(project, syncedAt);

    if (!frozen) {
      await this.step('task capture', () =>
        this.deps.taskCapture.invoke(project, syncedAt),
      );
      await this.step('task fields', () =>
        this.deps.taskFields.invoke(project),
      );
    }

    await this.deletions(project, note.connections);

    return this.stepErrors;
  }

  private async migrate(
    project: string,
    note: ProjectNoteDataTransferObject,
  ): Promise<void> {
    await this.step('migrate home note', () =>
      this.deps.migrateHomeNote.execute({
        projectName: project,
        notePath: note.path,
        locationArchived: archivedFromPath(note.path),
      }),
    );
  }

  private async renameProject(
    project: string,
    note: ProjectNoteDataTransferObject,
  ): Promise<void> {
    await this.step('rename project', async () => {
      const warnings = await this.deps.renameProject.execute({
        projectName: project,
        notePath: note.path,
        locationArchived: archivedFromPath(note.path),
        connections: note.connections,
      });
      for (const warning of warnings) {
        console.warn(warning);
      }
    });
  }

  private async rekey(
    project: string,
    connections: readonly ConnectionDataTransferObject[],
  ): Promise<void> {
    await this.step('rekey connections', async () => {
      const rekey = this.deps.rekeyRenamedConnections;
      if (rekey === undefined) {
        return;
      }
      const warnings = await rekey.execute({
        projectName: project,
        connections,
      });
      for (const warning of warnings) {
        console.warn(warning);
      }
    });
  }

  private async ensureBoards(
    project: string,
    note: ProjectNoteDataTransferObject,
  ): Promise<void> {
    const ensureBoard = this.deps.ensureProjectBoard;
    if (ensureBoard === undefined) {
      return;
    }
    for (const connection of note.connections) {
      const setup = this.deps.mirrorAdapters.create(
        connection.application,
        connection.target,
        connection.slug,
        project,
      );
      if (setup === null) {
        continue;
      }
      await this.step(`ensure board ${connection.slug}`, () =>
        ensureBoard.execute({
          projectName: project,
          connectionSlug: connection.slug,
          target: connection.target,
          setup,
        }),
      );
    }
  }

  private async renames(project: string, syncedAt: string): Promise<void> {
    await this.step('renames', () =>
      this.deps.detectNoteRenames.execute({ projectName: project, syncedAt }),
    );
  }

  private async vaultConsistency(
    project: string,
    syncedAt: string,
  ): Promise<void> {
    for (const notePath of await this.listNotes(project, 'taken')) {
      await this.step(`cascade ${notePath}`, () =>
        this.deps.completeTaskCascade.execute({
          notePath,
          projectName: project,
          syncedAt,
        }),
      );
      await this.step(`checklist ${notePath}`, () =>
        this.deps.syncChecklist.execute({
          notePath,
          projectName: project,
          syncedAt,
        }),
      );
    }

    for (const todoPath of await this.listNotes(project, 'taken')) {
      await this.step(`mirror ${todoPath}`, () =>
        this.deps.mirrorTodoStatus.execute({ todoPath, syncedAt }),
      );
    }
  }

  private async deletions(
    project: string,
    connections: readonly ConnectionDataTransferObject[],
  ): Promise<void> {
    await this.step('deletions', () =>
      this.deps.sweepDeletedNotes.execute({
        projectName: project,
        connections,
      }),
    );
  }

  private async resolveProject(
    project: string,
  ): Promise<ProjectNoteDataTransferObject | null> {
    const notes = await this.deps.vault.findProjectNotes();
    return notes.find((note) => note.projectName === project) ?? null;
  }

  private async reconcileLifecycle(
    project: string,
    note: ProjectNoteDataTransferObject,
  ): Promise<{ frozen: boolean; wasFrozen: boolean }> {
    try {
      return await this.deps.lifecycle.invoke(project);
    } catch (error) {
      console.error(
        `SyncProjectAction: lifecycle failed for ${project}`,
        error,
      );
      return { frozen: archivedFromPath(note.path), wasFrozen: false };
    }
  }

  private async listNotes(
    project: string,
    folder: string,
  ): Promise<readonly string[]> {
    try {
      return await this.deps.vault.listNotesInFolder(
        `Projecten/${project}/${folder}`,
      );
    } catch (error) {
      console.error(`SyncProjectAction: list ${folder} failed`, error);
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
