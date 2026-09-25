import type { ProjectNoteData } from '../DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../DataTransferObjects/ProjectStateData.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { HandleDeletedNoteAction } from './HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from './MirrorTodoStatusAction.js';
import type { ProbeProjectsAction } from './ProbeProjectsAction.js';
import type { ReconcileArchiveStateAction } from './ReconcileArchiveStateAction.js';
import type { ReconcileTaskAction } from './ReconcileTaskAction.js';
import type { SyncChecklistAction } from './SyncChecklistAction.js';
import type { SyncGithubTasksAction } from './SyncGithubTasksAction.js';
import type { SyncTodoistTasksAction } from './SyncTodoistTasksAction.js';
import type { WatchArchivedProjectAction } from './WatchArchivedProjectAction.js';

// THE CHAIN (t2 interim): one work item kind — a project folder name — and one
// entry point. The chain re-resolves the project from the vault, so a stale
// work item (a renamed-away project) no-ops and project-level deletion is never
// propagated from a stale item. Steps compose the interim halves; each step is
// isolated, so a failure logs and skips that step and the GitHub half failing
// never blocks the Todoist half (or vice versa). Snapshots and cursors advance
// only on success, preserved by the underlying actions.
//
// The interim composition (t3/t4 rebuild the halves on the canonical pipeline):
//
//   1. resolve project (inline) — pm-note exists? else no-op
//   2. GitHub-side lifecycle — ReconcileArchiveState → WatchArchivedProject
//   3. renames — DetectNoteRenamesAction (snapshot drift)
//   4. GitHub half — probe → SyncGithubTasks sweep → per-note consistency loop
//   5. Todoist half — SyncTodoistTasks (the old runTodoistHalf body)
//   6. deletions last — status records whose note is gone
//
// The probe is hoisted to the top of the GitHub-side work because the interim
// lifecycle gate needs the probed `closed`/`hasGithub` state; the task's step-4
// wording places it with the sweep, but one probe serves both.
export class SyncProjectAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly probeProjects: ProbeProjectsAction,
    private readonly reconcileArchiveState: ReconcileArchiveStateAction,
    private readonly watchArchivedProject: WatchArchivedProjectAction,
    private readonly detectNoteRenames: DetectNoteRenamesAction,
    private readonly syncGithubTasks: SyncGithubTasksAction,
    private readonly syncChecklist: SyncChecklistAction,
    private readonly reconcileTask: ReconcileTaskAction,
    private readonly mirrorTodoStatus: MirrorTodoStatusAction,
    private readonly syncTodoistTasks: SyncTodoistTasksAction,
    private readonly handleDeletedNote: HandleDeletedNoteAction,
  ) {}

  async execute(project: string): Promise<void> {
    const syncedAt = new Date().toISOString();

    // 1. Resolve project — a stale work item no-ops. The note's absence is not
    // a synced fact, so a missing pm-note never propagates a deletion.
    const note = await this.resolveProject(project);
    if (!note) {
      return;
    }

    // The probe is a GitHub-side read. A failure leaves the GitHub side
    // skipped but never blocks the Todoist half.
    const state = await this.probe(project);

    // 2. GitHub-side lifecycle (interim).
    await this.step('github lifecycle', () =>
      this.runGithubLifecycle(project, note, state, syncedAt),
    );

    // 3. Renames.
    await this.step('renames', () =>
      this.detectNoteRenames.execute({ projectName: project, syncedAt }),
    );

    // 4. GitHub half (interim wrap).
    await this.step('github half', () =>
      this.runGithubHalf(project, note, state, syncedAt),
    );

    // 5. Todoist half (interim wrap).
    await this.step('todoist half', () =>
      this.syncTodoistTasks.execute({
        projectName: project,
        notePath: note.path,
        locationArchived: note.archived,
        syncedAt,
      }),
    );

    // 6. Deletions last.
    await this.step('deletions', () => this.runDeletions(project));
  }

  private async resolveProject(
    project: string,
  ): Promise<ProjectNoteData | null> {
    const notes = await this.vault.findProjectNotes();
    return notes.find((note) => note.projectName === project) ?? null;
  }

  private async probe(project: string): Promise<ProjectStateData | undefined> {
    try {
      return (await this.probeProjects.execute([project])).get(project);
    } catch (error) {
      console.error(`SyncProjectAction: probe failed for ${project}`, error);
      return undefined;
    }
  }

  private async runGithubLifecycle(
    project: string,
    note: ProjectNoteData,
    state: ProjectStateData | undefined,
    syncedAt: string,
  ): Promise<void> {
    // A project without a probed GitHub state has no board to reconcile; the
    // Todoist half still mirrors it.
    if (!state) {
      return;
    }
    await this.reconcileArchiveState.execute({
      projectName: project,
      locationArchived: note.archived,
      closed: state.closed,
      syncedAt,
    });
    if (note.archived) {
      await this.watchArchivedProject.execute({
        projectName: project,
        syncedAt,
      });
    }
  }

  private async runGithubHalf(
    project: string,
    note: ProjectNoteData,
    state: ProjectStateData | undefined,
    syncedAt: string,
  ): Promise<void> {
    if (!state || note.archived || state.closed) {
      return;
    }

    const lastUpdate = await this.syncState.getLastProjectUpdate(project);
    const includeBoard = state.updatedAt !== lastUpdate;
    try {
      await this.syncGithubTasks.execute({
        projectName: project,
        syncedAt,
        includeBoard,
      });
      await this.syncState.setLastProjectUpdate(project, state.updatedAt);
    } catch (error) {
      // A failed sweep must not advance the stored update, so the next tick
      // sees the same updatedAt and retries the board fetch. The per-note loop
      // still runs: it replaces the independent note-event paths.
      console.error(
        `SyncProjectAction: github sweep failed for ${project}`,
        error,
      );
    }

    await this.runNoteSweep(project, syncedAt);
  }

  // The per-note consistency loop: the old per-note event paths (reconcile,
  // mirror) at project granularity. Deliberately coarser than the old event
  // path — every task note is checklist-synced and reconciled, every to-do
  // mirrored — but verdict-gated, so a settled note writes nothing. t3 replaces
  // it with the single-query fetch + canonical diff.
  private async runNoteSweep(project: string, syncedAt: string): Promise<void> {
    const taken = await this.vault.listNotesInFolder(
      `Projecten/${project}/taken`,
    );
    for (const notePath of taken) {
      await this.step(`checklist ${notePath}`, () =>
        this.syncChecklist.execute({
          notePath,
          projectName: project,
          syncedAt,
        }),
      );
      await this.step(`reconcile ${notePath}`, () =>
        this.reconcileTask.execute({
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

  private async runDeletions(project: string): Promise<void> {
    const prefix = `Projecten/${project}/`;
    for (const record of await this.syncState.list()) {
      if (!record.notePath.startsWith(prefix)) {
        continue;
      }
      if ((await this.vault.getNoteByPath(record.notePath)) === null) {
        await this.step(`delete ${record.notePath}`, () =>
          this.handleDeletedNote.execute({
            notePath: record.notePath,
            projectName: project,
          }),
        );
      }
    }
  }

  private async step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error(`SyncProjectAction: ${name} failed`, error);
    }
  }
}
