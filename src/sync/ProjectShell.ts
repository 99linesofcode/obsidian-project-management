import type { ConnectionData } from '../core/ConnectionData.js';
import type { ProjectNoteData } from '../core/ProjectNoteData.js';
import type { NoteEnumeratorPort } from '../core/ports/NoteEnumeratorPort.js';
import type { NoteReaderPort } from '../core/ports/NoteReaderPort.js';
import type { NoteWriterPort } from '../core/ports/NoteWriterPort.js';
import type { ProjectSetupFactoryPort } from '../core/ports/ProjectSetupFactoryPort.js';
import type { TrackedEntityPort } from '../core/ports/TrackedEntityPort.js';
import type { EnsureProjectBoardAction } from '../projects/EnsureProjectBoardAction.js';
import { MigrateProjectHomeNoteAction } from '../projects/MigrateProjectHomeNoteAction.js';
import type { RekeyRenamedConnectionsAction } from '../projects/RekeyRenamedConnectionsAction.js';
import type { CompleteTaskCascadeAction } from '../tasks/CompleteTaskCascadeAction.js';
import type { MirrorTodoStatusAction } from '../todos/MirrorTodoStatusAction.js';
import type { SyncChecklistAction } from '../todos/SyncChecklistAction.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { HandleDeletedNoteAction } from './HandleDeletedNoteAction.js';
import { SweepDeletedNotesAction } from './SweepDeletedNotesAction.js';

export interface ProjectShellDependencies {
  vault: NoteReaderPort & NoteWriterPort & NoteEnumeratorPort;
  syncState: TrackedEntityPort;
  setupFactory: ProjectSetupFactoryPort;
  detectNoteRenames: DetectNoteRenamesAction;
  completeTaskCascade: CompleteTaskCascadeAction;
  syncChecklist: SyncChecklistAction;
  mirrorTodoStatus: MirrorTodoStatusAction;
  handleDeletedNote: HandleDeletedNoteAction;
  ensureProjectBoard?: EnsureProjectBoardAction | undefined;
  rekeyRenamedConnections?: RekeyRenamedConnectionsAction | undefined;
}

// The vault-maintenance half of the chain: everything a sync pass does to the
// vault outside mirror reconciliation. Each step isolates its own failure and
// records it, so one broken step never starves the rest.
export class ProjectShell {
  private readonly vault: ProjectShellDependencies['vault'];
  private readonly setupFactory: ProjectSetupFactoryPort;
  private readonly detectNoteRenames: DetectNoteRenamesAction;
  private readonly completeTaskCascade: CompleteTaskCascadeAction;
  private readonly syncChecklist: SyncChecklistAction;
  private readonly mirrorTodoStatus: MirrorTodoStatusAction;
  private readonly ensureProjectBoard: EnsureProjectBoardAction | undefined;
  private readonly rekeyRenamedConnections:
    RekeyRenamedConnectionsAction | undefined;
  private readonly migrateProjectHomeNote: MigrateProjectHomeNoteAction;
  private readonly sweepDeletedNotes: SweepDeletedNotesAction;
  private stepErrors: unknown[] = [];

  constructor(deps: ProjectShellDependencies) {
    this.vault = deps.vault;
    this.setupFactory = deps.setupFactory;
    this.detectNoteRenames = deps.detectNoteRenames;
    this.completeTaskCascade = deps.completeTaskCascade;
    this.syncChecklist = deps.syncChecklist;
    this.mirrorTodoStatus = deps.mirrorTodoStatus;
    this.ensureProjectBoard = deps.ensureProjectBoard;
    this.rekeyRenamedConnections = deps.rekeyRenamedConnections;
    this.migrateProjectHomeNote = new MigrateProjectHomeNoteAction(deps.vault);
    this.sweepDeletedNotes = new SweepDeletedNotesAction(
      deps.vault,
      deps.syncState,
      deps.handleDeletedNote,
    );
  }

  reset(): void {
    this.stepErrors = [];
  }

  get errors(): readonly unknown[] {
    return this.stepErrors;
  }

  async migrate(project: string, note: ProjectNoteData): Promise<void> {
    await this.step('migrate home note', () =>
      this.migrateProjectHomeNote.execute({
        projectName: project,
        notePath: note.path,
        locationArchived: note.archivedAt !== null,
      }),
    );
  }

  async rekey(
    project: string,
    connections: Record<string, ConnectionData>,
  ): Promise<void> {
    await this.step('rekey connections', async () => {
      if (this.rekeyRenamedConnections === undefined) {
        return;
      }
      const warnings = await this.rekeyRenamedConnections.execute({
        projectName: project,
        connections,
      });
      for (const warning of warnings) {
        console.warn(warning);
      }
    });
  }

  async ensureBoards(project: string, note: ProjectNoteData): Promise<void> {
    if (this.ensureProjectBoard === undefined || note.archivedAt !== null) {
      return;
    }
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

  async renames(project: string, syncedAt: string): Promise<void> {
    await this.step('renames', () =>
      this.detectNoteRenames.execute({ projectName: project, syncedAt }),
    );
  }

  async vaultConsistency(project: string, syncedAt: string): Promise<void> {
    for (const notePath of await this.listNotes(project, 'taken')) {
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

    for (const todoPath of await this.listNotes(project, 'todos')) {
      await this.step(`mirror ${todoPath}`, () =>
        this.mirrorTodoStatus.execute({ todoPath, syncedAt }),
      );
    }
  }

  async deletions(
    project: string,
    connections: Record<string, ConnectionData>,
  ): Promise<void> {
    await this.step('deletions', () =>
      this.sweepDeletedNotes.execute({
        projectName: project,
        connections: Object.entries(connections).map(([slug, connection]) => ({
          slug,
          application: connection.tool,
          target: connection.project,
        })),
      }),
    );
  }

  private async listNotes(
    project: string,
    folder: string,
  ): Promise<readonly string[]> {
    try {
      return await this.vault.listNotesInFolder(
        `Projecten/${project}/${folder}`,
      );
    } catch (error) {
      console.error(`ProjectShell: list ${folder} failed`, error);
      this.stepErrors.push(error);
      return [];
    }
  }

  private async step(name: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error(`ProjectShell: ${name} failed`, error);
      this.stepErrors.push(error);
    }
  }
}
