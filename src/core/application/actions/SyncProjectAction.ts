import type { ConnectionDataTransferObject } from '../data/ConnectionDataTransferObject.js';
import type { ProjectNoteDataTransferObject } from '../data/ProjectNoteDataTransferObject.js';
import type { NoteEnumeratorPort } from '../../port/NoteEnumeratorPort.js';
import type { NoteReaderPort } from '../../port/NoteReaderPort.js';
import type { NoteWriterPort } from '../../port/NoteWriterPort.js';
import type { ProjectSetupFactoryPort } from '../../port/ProjectSetupFactoryPort.js';
import type { CoreReconcilers } from '../services/CoreReconcilers.js';
import type { CompleteTaskCascadeAction } from './CompleteTaskCascadeAction.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { EnsureProjectBoardAction } from './EnsureProjectBoardAction.js';
import type { MigrateProjectHomeNoteAction } from './MigrateProjectHomeNoteAction.js';
import type { MirrorTodoStatusAction } from './MirrorTodoStatusAction.js';
import type { RekeyRenamedConnectionsAction } from './RekeyRenamedConnectionsAction.js';
import type { SweepDeletedNotesAction } from './SweepDeletedNotesAction.js';
import type { SyncChecklistAction } from './sync-checklist/SyncChecklistAction.js';

export interface SyncProjectDependencies {
  vault: NoteReaderPort & NoteWriterPort & NoteEnumeratorPort;
  setupFactory: ProjectSetupFactoryPort;
  reconcilers: CoreReconcilers;
  migrateHomeNote: MigrateProjectHomeNoteAction;
  detectNoteRenames: DetectNoteRenamesAction;
  completeTaskCascade: CompleteTaskCascadeAction;
  syncChecklist: SyncChecklistAction;
  mirrorTodoStatus: MirrorTodoStatusAction;
  sweepDeletedNotes: SweepDeletedNotesAction;
  rekeyRenamedConnections?: RekeyRenamedConnectionsAction | undefined;
  ensureProjectBoard?: EnsureProjectBoardAction | undefined;
}

// The pass for one project: it drives the vault-maintenance steps and the core
// reconcilers in order, isolating each step's failure so one broken step never
// starves the rest.
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
    await this.rekey(project, note.connections);
    await this.ensureBoards(project, note);

    await this.step('reactivation', () =>
      this.deps.reconcilers.reactivation.reactivate(project),
    );

    const { frozen, wasFrozen } = await this.reconcileLifecycle(project, note);

    await this.step('task locks', () =>
      this.deps.reconcilers.taskLocks.reconcile({ project, frozen, wasFrozen }),
    );

    await this.renames(project, syncedAt);
    await this.vaultConsistency(project, syncedAt);

    if (!frozen) {
      await this.step('task capture', () =>
        this.deps.reconcilers.taskCapture.capture(project, syncedAt),
      );
      await this.step('task fields', () =>
        this.deps.reconcilers.taskFields.reconcile(project),
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
        locationArchived: note.archivedAt !== null,
      }),
    );
  }

  private async rekey(
    project: string,
    connections: Record<string, ConnectionDataTransferObject>,
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
    for (const [slug, connection] of Object.entries(note.connections)) {
      const setup = this.deps.setupFactory.setupFor(connection.tool);
      if (setup === null) {
        continue;
      }
      await this.step(`ensure board ${slug}`, () =>
        ensureBoard.execute({
          projectName: project,
          connectionSlug: slug,
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

    for (const todoPath of await this.listNotes(project, 'todos')) {
      await this.step(`mirror ${todoPath}`, () =>
        this.deps.mirrorTodoStatus.execute({ todoPath, syncedAt }),
      );
    }
  }

  private async deletions(
    project: string,
    connections: Record<string, ConnectionDataTransferObject>,
  ): Promise<void> {
    await this.step('deletions', () =>
      this.deps.sweepDeletedNotes.execute({
        projectName: project,
        connections: Object.entries(connections).map(([slug, connection]) => ({
          slug,
          application: connection.tool,
          target: connection.project,
        })),
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
      return await this.deps.reconcilers.lifecycle.reconcile(project);
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
