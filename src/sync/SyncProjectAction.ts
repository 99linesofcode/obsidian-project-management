import type { ProjectNoteData } from '../core/ProjectNoteData.js';
import type { NoteEnumeratorPort } from '../core/ports/NoteEnumeratorPort.js';
import type { CoreReconcilers } from './CoreReconcilers.js';
import type { ProjectShell } from './ProjectShell.js';

// The sync chain: it drives the vault-maintenance shell and the core
// reconcilers in order, isolating each step's failure. The shell owns what the
// pass does to the vault; the reconcilers own the mirror round-trip.
export class SyncProjectAction {
  private stepErrors: unknown[] = [];

  constructor(
    private readonly vault: NoteEnumeratorPort,
    private readonly shell: ProjectShell,
    private readonly reconcilers: CoreReconcilers,
  ) {}

  async execute(project: string): Promise<unknown[]> {
    this.stepErrors = [];
    this.shell.reset();
    const syncedAt = new Date().toISOString();

    const note = await this.resolveProject(project);
    if (!note) {
      return this.stepErrors;
    }

    await this.shell.migrate(project, note);
    await this.shell.rekey(project, note.connections);
    await this.shell.ensureBoards(project, note);

    await this.step('reactivation', () =>
      this.reconcilers.reactivation.reactivate(project),
    );

    const { frozen, wasFrozen } = await this.reconcileLifecycle(project, note);

    await this.step('task locks', () =>
      this.reconcilers.taskLocks.reconcile({ project, frozen, wasFrozen }),
    );

    await this.shell.renames(project, syncedAt);
    await this.shell.vaultConsistency(project, syncedAt);

    if (!frozen) {
      await this.step('task capture', () =>
        this.reconcilers.taskCapture.capture(project, syncedAt),
      );
      await this.step('task fields', () =>
        this.reconcilers.taskFields.reconcile(project),
      );
    }

    await this.shell.deletions(project, note.connections);

    return [...this.shell.errors, ...this.stepErrors];
  }

  private async resolveProject(
    project: string,
  ): Promise<ProjectNoteData | null> {
    const notes = await this.vault.findProjectNotes();
    return notes.find((note) => note.projectName === project) ?? null;
  }

  private async reconcileLifecycle(
    project: string,
    note: ProjectNoteData,
  ): Promise<{ frozen: boolean; wasFrozen: boolean }> {
    try {
      return await this.reconcilers.lifecycle.reconcile(project);
    } catch (error) {
      console.error(
        `SyncProjectAction: lifecycle failed for ${project}`,
        error,
      );
      return { frozen: note.archivedAt !== null, wasFrozen: false };
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
