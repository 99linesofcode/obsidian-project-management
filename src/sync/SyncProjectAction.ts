import type { ProjectNoteData } from '../shared/ProjectNoteData.js';
import type { ProjectStateData } from '../shared/ProjectStateData.js';
import type { ConnectionData } from '../shared/ConnectionData.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { HandleDeletedNoteAction } from './HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from '../todos/MirrorTodoStatusAction.js';
import type { ProbeProjectsAction } from './ProbeProjectsAction.js';
import type {
  ProjectLifecycleVerdict,
  ReconcileProjectLifecycleAction,
} from '../projects/ReconcileProjectLifecycleAction.js';
import type { SyncChecklistAction } from '../todos/SyncChecklistAction.js';
import type { CompleteTaskCascadeAction } from '../tasks/CompleteTaskCascadeAction.js';
import type { ConnectionSyncHalf, SyncHalfFactory } from './SyncHalves.js';
import type { ProjectLifecycleReconciler } from './ProjectLifecycleReconciler.js';
import type { TaskFieldReconciler } from './TaskFieldReconciler.js';
import type { EnsureProjectBoardAction } from '../projects/EnsureProjectBoardAction.js';
import type { RekeyRenamedConnectionsAction } from '../projects/RekeyRenamedConnectionsAction.js';
import { SweepDeletedNotesAction } from './SweepDeletedNotesAction.js';

export class SyncProjectAction {
  private readonly sweepDeletedNotes: SweepDeletedNotesAction;
  private stepErrors: unknown[] = [];

  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly probeProjects: ProbeProjectsAction,
    private readonly reconcileProjectLifecycle: ReconcileProjectLifecycleAction,
    private readonly detectNoteRenames: DetectNoteRenamesAction,
    private readonly halfFactory: SyncHalfFactory,
    private readonly completeTaskCascade: CompleteTaskCascadeAction,
    private readonly syncChecklist: SyncChecklistAction,
    private readonly mirrorTodoStatus: MirrorTodoStatusAction,
    handleDeletedNote: HandleDeletedNoteAction,
    private readonly ensureProjectBoard?: EnsureProjectBoardAction,
    private readonly rekeyRenamedConnections?: RekeyRenamedConnectionsAction,
    private readonly taskFieldReconciler?: () => TaskFieldReconciler | undefined,
    private readonly projectLifecycleReconciler?: () => ProjectLifecycleReconciler | undefined,
  ) {
    this.sweepDeletedNotes = new SweepDeletedNotesAction(
      vault,
      syncState,
      handleDeletedNote,
    );
  }

  async execute(project: string): Promise<unknown[]> {
    this.stepErrors = [];
    const syncedAt = new Date().toISOString();

    const note = await this.resolveProject(project);
    if (!note) {
      return this.stepErrors;
    }

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
        if (connection.tool !== 'github') {
          continue;
        }
        await this.step(`ensure board ${slug}`, () =>
          this.ensureProjectBoard!.execute({
            projectName: project,
            connectionSlug: slug,
          }),
        );
      }
    }

    const boardState = await this.probe(project, note.connections);

    const lifecycleReconciler = this.projectLifecycleReconciler?.();
    const verdict =
      lifecycleReconciler === undefined
        ? await this.runLifecycle(project, note, boardState, syncedAt)
        : await this.runNewLifecycle(
            project,
            note,
            boardState,
            lifecycleReconciler,
          );

    await this.step('renames', () =>
      this.detectNoteRenames.execute({ projectName: project, syncedAt }),
    );

    const halves = Object.entries(note.connections)
      .map(([slug, connection]) => this.halfFactory.create(slug, connection))
      .filter((half): half is ConnectionSyncHalf => half !== null);
    const taskFieldReconciler = this.taskFieldReconciler?.();

    if (taskFieldReconciler === undefined) {
      await this.step('code host half', () =>
        this.runBoardHalves(
          project,
          note.connections,
          halves,
          boardState,
          verdict,
          syncedAt,
        ),
      );
    }

    await this.step('vault consistency', () =>
      this.runVaultConsistency(project, syncedAt),
    );

    if (!verdict.frozen) {
      if (taskFieldReconciler === undefined) {
        await this.step('task manager half', () =>
          this.runTaskHalves(project, note.connections, halves, syncedAt),
        );
      } else {
        await this.step('task fields', () =>
          taskFieldReconciler.reconcile(project),
        );
      }
    }

    await this.step('deletions', async () => {
      for (const half of halves) {
        if (!half.requiresBoard) {
          continue;
        }
        await this.sweepDeletedNotes.execute({
          projectName: project,
          connectionSlug: half.connectionSlug,
        });
      }
    });

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
        .filter(([, connection]) => connection.tool === 'github')
        .map(([slug]) => ({ projectName: project, connectionSlug: slug }));
      return (await this.probeProjects.execute(targets)).get(project);
    } catch (error) {
      console.error(`SyncProjectAction: probe failed for ${project}`, error);
      return undefined;
    }
  }

  private async runLifecycle(
    project: string,
    note: ProjectNoteData,
    boardState: ProjectStateData | undefined,
    syncedAt: string,
  ): Promise<ProjectLifecycleVerdict> {
    try {
      return await this.reconcileProjectLifecycle.execute({
        projectName: project,
        notePath: note.path,
        locationArchived: note.archivedAt !== null,
        syncedAt,
        ...(boardState === undefined ? {} : { closed: boardState.closed }),
      });
    } catch (error) {
      console.error(
        `SyncProjectAction: lifecycle failed for ${project}`,
        error,
      );
      return {
        remoteProjectId: null,
        frozen: note.archivedAt !== null || (boardState?.closed ?? false),
        notePath: note.path,
        archivedAt: note.archivedAt,
      };
    }
  }

  private async runNewLifecycle(
    project: string,
    note: ProjectNoteData,
    boardState: ProjectStateData | undefined,
    reconciler: ProjectLifecycleReconciler,
  ): Promise<ProjectLifecycleVerdict> {
    try {
      const { frozen } = await reconciler.reconcile(project);
      return {
        remoteProjectId: null,
        frozen,
        notePath: note.path,
        archivedAt: frozen ? '' : null,
      };
    } catch (error) {
      console.error(
        `SyncProjectAction: lifecycle failed for ${project}`,
        error,
      );
      return {
        remoteProjectId: null,
        frozen: note.archivedAt !== null || (boardState?.closed ?? false),
        notePath: note.path,
        archivedAt: note.archivedAt,
      };
    }
  }

  private async runBoardHalves(
    project: string,
    connections: Record<string, ConnectionData>,
    halves: ConnectionSyncHalf[],
    boardState: ProjectStateData | undefined,
    verdict: ProjectLifecycleVerdict,
    syncedAt: string,
  ): Promise<void> {
    if (!boardState || verdict.frozen) {
      return;
    }

    const lastUpdate = await this.syncState.getLastProjectUpdate(project);
    const fullScanPending = await this.syncState.isFullScanPending(project);
    const includeBoard = boardState.updatedAt !== lastUpdate || fullScanPending;
    let failed = false;
    for (const half of halves) {
      if (!half.requiresBoard) {
        continue;
      }
      try {
        await half.execute({
          projectName: project,
          syncedAt,
          includeBoard,
          connections,
        });
      } catch (error) {
        failed = true;
        console.error(
          `SyncProjectAction: code host half failed for ${project}`,
          error,
        );
      }
    }
    if (!failed) {
      await this.syncState.setLastProjectUpdate(project, boardState.updatedAt);
      if (fullScanPending) {
        await this.syncState.consumeFullScan(project);
      }
    }
  }

  private async runTaskHalves(
    project: string,
    connections: Record<string, ConnectionData>,
    halves: ConnectionSyncHalf[],
    syncedAt: string,
  ): Promise<void> {
    for (const half of halves) {
      if (half.requiresBoard) {
        continue;
      }
      await this.step(`task half ${half.connectionSlug}`, () =>
        half.execute({
          projectName: project,
          syncedAt,
          includeBoard: false,
          connections,
        }),
      );
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
