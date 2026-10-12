import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { ProjectNoteDataTransferObject } from '../../port/data/ProjectNoteDataTransferObject.js';
import type { VaultPort } from '../../port/VaultPort.js';
import type { ProjectSetupFactoryPort } from '../../port/ProjectSetupFactoryPort.js';
import type { CaptureTasksAction } from './capture-tasks/CaptureTasksAction.js';
import type { CompleteTaskCascadeAction } from './CompleteTaskCascadeAction.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { EnsureProjectBoardAction } from './EnsureProjectBoardAction.js';
import type { MigrateLabelsAction } from './MigrateLabelsAction.js';
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
  setupFactory: ProjectSetupFactoryPort;
  lifecycle: ProjectLifecycleSyncAction;
  taskLocks: ReconcileProjectTaskLocksAction;
  taskCapture: CaptureTasksAction;
  taskFields: MirrorSyncAction;
  migrateLabels: Pick<MigrateLabelsAction, 'execute'>;
  migrateHomeNote: MigrateProjectHomeNoteAction;
  detectNoteRenames: DetectNoteRenamesAction;
  completeTaskCascade: CompleteTaskCascadeAction;
  syncChecklist: SyncChecklistAction;
  mirrorTodoStatus: MirrorTodoStatusAction;
  sweepDeletedNotes: SweepDeletedNotesAction;
  rekeyRenamedConnections?: RekeyRenamedConnectionsAction | undefined;
  ensureProjectBoard?: EnsureProjectBoardAction | undefined;
}

// The pass for one project: it drives the vault-maintenance steps and the
// reconciliation actions in order, isolating each step's failure so one broken
// step never starves the rest.
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

    await this.migrateLabels(project);
    await this.migrate(project, note);
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

  private async migrateLabels(project: string): Promise<void> {
    await this.step('migrate labels', () =>
      this.deps.migrateLabels.execute({ projectName: project }),
    );
  }

  private async migrate(
    project: string,
    note: ProjectNoteDataTransferObject,
  ): Promise<void> {
    await this.step('migrate home note', () =>
      this.deps.migrateHomeNote.execute({
        projectName: project,
        notePath: note.path,
        locationArchived: note.archivedAt !== null,
      }),
    );
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
    if (ensureBoard === undefined || note.archivedAt !== null) {
      return;
    }
    for (const connection of note.connections) {
      const setup = this.deps.setupFactory.setupFor(connection.application);
      if (setup === null) {
        continue;
      }
      await this.step(`ensure board ${connection.slug}`, () =>
        ensureBoard.execute({
          projectName: project,
          connectionSlug: connection.slug,
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
      return { frozen: note.archivedAt !== null, wasFrozen: false };
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
