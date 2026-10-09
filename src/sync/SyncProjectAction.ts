import type { ProjectNoteData } from '../core/ProjectNoteData.js';
import type { ProjectStateData } from '../shared/ProjectStateData.js';
import type { ConnectionData } from '../core/ConnectionData.js';
import type { ProjectSetupFactoryPort } from '../core/ports/ProjectSetupFactoryPort.js';
import type { SyncStatePort } from '../core/SyncStatePort.js';
import type { VaultPort } from '../core/VaultPort.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { HandleDeletedNoteAction } from './HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from '../todos/MirrorTodoStatusAction.js';
import type { ProbeProjectsAction } from './ProbeProjectsAction.js';
import type { SyncChecklistAction } from '../todos/SyncChecklistAction.js';
import type { CompleteTaskCascadeAction } from '../tasks/CompleteTaskCascadeAction.js';
import type { ProjectLifecycleReconciler } from './ProjectLifecycleReconciler.js';
import type { ProjectReactivationReconciler } from './ProjectReactivationReconciler.js';
import type { ProjectTaskLocksReconciler } from './ProjectTaskLocksReconciler.js';
import type { TaskCaptureReconciler } from './TaskCaptureReconciler.js';
import type { TaskFieldReconciler } from './TaskFieldReconciler.js';
import type { EnsureProjectBoardAction } from '../projects/EnsureProjectBoardAction.js';
import type { RekeyRenamedConnectionsAction } from '../projects/RekeyRenamedConnectionsAction.js';
import { MigrateProjectHomeNoteAction } from '../projects/MigrateProjectHomeNoteAction.js';
import { SweepDeletedNotesAction } from './SweepDeletedNotesAction.js';

export class SyncProjectAction {
  private readonly sweepDeletedNotes: SweepDeletedNotesAction;
  private readonly migrateProjectHomeNote: MigrateProjectHomeNoteAction;
  private stepErrors: unknown[] = [];

  constructor(
    private readonly vault: VaultPort,
    private readonly setupFactory: ProjectSetupFactoryPort,
    syncState: SyncStatePort,
    private readonly probeProjects: ProbeProjectsAction,
    private readonly detectNoteRenames: DetectNoteRenamesAction,
    private readonly completeTaskCascade: CompleteTaskCascadeAction,
    private readonly syncChecklist: SyncChecklistAction,
    private readonly mirrorTodoStatus: MirrorTodoStatusAction,
    handleDeletedNote: HandleDeletedNoteAction,
    private readonly taskFieldReconciler: () => TaskFieldReconciler,
    private readonly projectLifecycleReconciler: () => ProjectLifecycleReconciler,
    private readonly taskCaptureReconciler: () => TaskCaptureReconciler,
    private readonly projectTaskLocksReconciler: () => ProjectTaskLocksReconciler,
    private readonly projectReactivationReconciler: () => ProjectReactivationReconciler,
    private readonly ensureProjectBoard?: EnsureProjectBoardAction,
    private readonly rekeyRenamedConnections?: RekeyRenamedConnectionsAction,
  ) {
    this.sweepDeletedNotes = new SweepDeletedNotesAction(
      vault,
      syncState,
      handleDeletedNote,
    );
    this.migrateProjectHomeNote = new MigrateProjectHomeNoteAction(vault);
  }

  async execute(project: string): Promise<unknown[]> {
    this.stepErrors = [];
    const syncedAt = new Date().toISOString();

    const note = await this.resolveProject(project);
    if (!note) {
      return this.stepErrors;
    }

    const lifecycleReconciler = this.projectLifecycleReconciler();
    const taskFieldReconciler = this.taskFieldReconciler();
    const taskCaptureReconciler = this.taskCaptureReconciler();
    const projectTaskLocksReconciler = this.projectTaskLocksReconciler();
    const projectReactivationReconciler = this.projectReactivationReconciler();

    await this.step('migrate home note', async () => {
      await this.migrateProjectHomeNote.execute({
        projectName: project,
        notePath: note.path,
        locationArchived: note.archivedAt !== null,
      });
    });

    if (this.rekeyRenamedConnections) {
      const warnings = await this.rekeyRenamedConnections.execute({
        projectName: project,
        connections: note.connections,
      });
      for (const warning of warnings) {
        console.warn(warning);
      }
    }

    if (this.ensureProjectBoard && note.archivedAt === null) {
      for (const [slug, connection] of Object.entries(note.connections)) {
        const setup = this.setupFactory.setupFor(connection.tool);
        if (setup === null) {
          continue;
        }
        await this.step(`ensure board ${slug}`, () =>
          this.ensureProjectBoard!.execute({
            projectName: project,
            connectionSlug: slug,
            setup,
          }),
        );
      }
    }

    const boardState = await this.probe(project, note.connections);

    await this.step('reactivation', async () => {
      await projectReactivationReconciler.reactivate(project);
    });

    const { frozen, wasFrozen } = await this.reconcileLifecycle(
      project,
      note,
      boardState,
      lifecycleReconciler,
    );

    await this.step('task locks', () =>
      projectTaskLocksReconciler.reconcile({
        project,
        frozen,
        wasFrozen,
      }),
    );

    await this.step('renames', () =>
      this.detectNoteRenames.execute({ projectName: project, syncedAt }),
    );

    await this.step('vault consistency', () =>
      this.runVaultConsistency(project, syncedAt),
    );

    if (!frozen) {
      await this.step('task capture', () =>
        taskCaptureReconciler.capture(project, syncedAt),
      );
      await this.step('task fields', () =>
        taskFieldReconciler.reconcile(project),
      );
    }

    await this.step('deletions', () =>
      this.sweepDeletedNotes.execute({
        projectName: project,
        connections: Object.entries(note.connections).map(
          ([slug, connection]) => ({
            slug,
            application: connection.tool,
            target: connection.project,
          }),
        ),
      }),
    );

    return this.stepErrors;
  }

  private async resolveProject(
    project: string,
  ): Promise<ProjectNoteData | null> {
    const notes = await this.vault.findProjectNotes();
    return notes.find((note) => note.projectName === project) ?? null;
  }

  private async probe(
    project: string,
    connections: Record<string, ConnectionData>,
  ): Promise<ProjectStateData | undefined> {
    try {
      const targets = Object.entries(connections)
        .filter(
          ([, connection]) =>
            this.setupFactory.setupFor(connection.tool) !== null,
        )
        .map(([slug, connection]) => ({
          projectName: project,
          connectionSlug: slug,
          application: connection.tool,
        }));
      return (await this.probeProjects.execute(targets)).get(project);
    } catch (error) {
      console.error(`SyncProjectAction: probe failed for ${project}`, error);
      return undefined;
    }
  }

  private async reconcileLifecycle(
    project: string,
    note: ProjectNoteData,
    boardState: ProjectStateData | undefined,
    reconciler: ProjectLifecycleReconciler,
  ): Promise<{ frozen: boolean; wasFrozen: boolean }> {
    try {
      return await reconciler.reconcile(project);
    } catch (error) {
      console.error(
        `SyncProjectAction: lifecycle failed for ${project}`,
        error,
      );
      return {
        frozen: note.archivedAt !== null || (boardState?.closed ?? false),
        wasFrozen: false,
      };
    }
  }

  private async runVaultConsistency(
    project: string,
    syncedAt: string,
  ): Promise<void> {
    const taken = await this.vault.listNotesInFolder(
      `Projecten/${project}/taken`,
    );
    for (const notePath of taken) {
      await this.step(`cascade ${notePath}`, () =>
        this.completeTaskCascade.execute({
          notePath,
          projectName: project,
          syncedAt,
        }),
      );
      await this.step(`checklist ${notePath}`, () =>
        this.syncChecklist.execute({
          notePath,
          projectName: project,
          syncedAt,
        }),
      );
    }

    const todos = await this.vault.listNotesInFolder(
      `Projecten/${project}/todos`,
    );
    for (const todoPath of todos) {
      await this.step(`mirror ${todoPath}`, () =>
        this.mirrorTodoStatus.execute({ todoPath, syncedAt }),
      );
    }
  }

  private async step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error(`SyncProjectAction: ${name} failed`, error);
      this.stepErrors.push(error);
    }
  }
}
