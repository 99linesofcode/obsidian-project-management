import type { ProjectNoteData } from '../projects/ProjectNoteData.js';
import type { ProjectStateData } from '../projects/ProjectStateData.js';
import type { SyncStatePort } from '../registry/SyncStatePort.js';
import type { VaultPort } from '../vault/VaultPort.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { CleanupNoteFrontmatterAction } from './CleanupNoteFrontmatterAction.js';
import type { HandleDeletedNoteAction } from './HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from '../todos/MirrorTodoStatusAction.js';
import type { ProbeProjectsAction } from './ProbeProjectsAction.js';
import type {
  ProjectLifecycleVerdict,
  ReconcileProjectLifecycleAction,
} from '../projects/ReconcileProjectLifecycleAction.js';
import type { SyncChecklistAction } from '../todos/SyncChecklistAction.js';
import type { CompleteTaskCascadeAction } from '../tasks/CompleteTaskCascadeAction.js';
import type { SyncGithubTasksAction } from './SyncGithubTasksAction.js';
import type { SyncTodoistTasksAction } from './SyncTodoistTasksAction.js';
import type { EnsureProjectBoardAction } from '../projects/EnsureProjectBoardAction.js';
import { SweepDeletedNotesAction } from './SweepDeletedNotesAction.js';

// THE CHAIN: one work item kind — a project folder name — and one entry point.
// The chain re-resolves the project from the vault, so a stale work item (a
// renamed-away project) no-ops and project-level deletion is never propagated
// from a stale item. Steps compose the halves; each step is isolated, so a
// failure logs and skips that step and the GitHub half failing never blocks the
// Todoist half (or vice versa). Snapshots and cursors advance only on success,
// preserved by the underlying actions.
//
//   1. resolve project — pm-note exists? else no-op
//   2. cleanup frontmatter — strip the legacy machine-id fields
//   3. ensure board (PRJ-1) — an active project with no board gains one
//   4. reconcile lifecycle — ONE freeze verdict (folder ⇄ archive ⇄ Todoist)
//   5. renames — DetectNoteRenamesAction (snapshot drift)
//   6. GitHub half — probe → SyncGithubTasks (single-query canonical pipeline)
//   7. vault consistency — checklist ↔ to-do (retained; verdict-independent)
//   8. Todoist half — SyncTodoistTasks (canonical pipeline; gated by the verdict)
//   9. deletions last — status records whose note is gone
//
// The probe is hoisted above the GitHub half because the lifecycle gate needs
// the probed `closed` state; one probe serves both. The board step runs BEFORE
// the probe so a board created this tick is visible to the probe and the GitHub
// half in the same pass.
export class SyncProjectAction {
  private readonly sweepDeletedNotes: SweepDeletedNotesAction;

  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly probeProjects: ProbeProjectsAction,
    private readonly reconcileProjectLifecycle: ReconcileProjectLifecycleAction,
    private readonly detectNoteRenames: DetectNoteRenamesAction,
    private readonly syncGithubTasks: SyncGithubTasksAction,
    private readonly completeTaskCascade: CompleteTaskCascadeAction,
    private readonly syncChecklist: SyncChecklistAction,
    private readonly mirrorTodoStatus: MirrorTodoStatusAction,
    private readonly syncTodoistTasks: SyncTodoistTasksAction,
    handleDeletedNote: HandleDeletedNoteAction,
    // The frontmatter cleanup. Optional so a chain assembled before the
    // identity layer (and the tests that pin the older halves) still
    // constructs.
    private readonly cleanupNoteFrontmatter?: CleanupNoteFrontmatterAction,
    // PRJ-1's board leg. Optional for the same reason as the cleanup: a chain
    // assembled before the project-propagation wave still constructs.
    private readonly ensureProjectBoard?: EnsureProjectBoardAction,
  ) {
    this.sweepDeletedNotes = new SweepDeletedNotesAction(
      vault,
      syncState,
      handleDeletedNote,
    );
  }

  async execute(project: string): Promise<void> {
    const syncedAt = new Date().toISOString();

    // Resolve project — a stale work item no-ops. The note's absence is not
    // a synced fact, so a missing pm-note never propagates a deletion.
    const note = await this.resolveProject(project);
    if (!note) {
      return;
    }

    // Strip the legacy machine-id frontmatter fields, before any half reads
    // notes. Best-effort: a malformed note is skipped, and a failure here must
    // not block the halves.
    if (this.cleanupNoteFrontmatter) {
      await this.step('cleanup frontmatter', () =>
        this.cleanupNoteFrontmatter!.execute({ projectName: project }),
      );
    }

    // Ensure the GitHub board exists (PRJ-1). Runs before the probe so a
    // board created this tick is visible to the probe and the GitHub half in
    // the same pass. An archived project never spawns a board: the folder
    // location is the vault's own freeze signal, and a frozen project accepts
    // no board work.
    if (this.ensureProjectBoard && note.archivedAt === null) {
      await this.step('ensure board', () =>
        this.ensureProjectBoard!.execute({
          projectName: project,
          notePath: note.path,
        }),
      );
    }

    // The probe is a GitHub-side read. A failure leaves the GitHub side
    // skipped but never blocks the Todoist half.
    const boardState = await this.probe(project);

    // Lifecycle — one freeze verdict for both halves. A failure leaves the
    // project frozen for this tick so no task write runs against an unknown
    // state; the next tick retries.
    const verdict = await this.runLifecycle(project, note, boardState, syncedAt);

    await this.step('renames', () =>
      this.detectNoteRenames.execute({ projectName: project, syncedAt }),
    );

    await this.step('github half', () =>
      this.runGithubHalf(project, boardState, verdict, syncedAt),
    );

    // Vault consistency — checklist ↔ to-do. Retained as its own step
    // because it must run for every task note regardless of the GitHub
    // verdict; the vault writer's surface covers the note body it writes.
    await this.step('vault consistency', () =>
      this.runVaultConsistency(project, syncedAt),
    );

    // Todoist half — gated by the freeze verdict. The lifecycle resolved the
    // project id; a frozen project accepts no task writes but stays observed.
    if (!verdict.frozen && verdict.todoistProjectId !== null) {
      await this.step('todoist half', () =>
        this.syncTodoistTasks.execute({
          projectName: project,
          projectId: verdict.todoistProjectId!,
          syncedAt,
        }),
      );
    }

    // Deletions last.
    await this.step('deletions', () =>
      this.sweepDeletedNotes.execute({ projectName: project }),
    );
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
      // The failure leaves the Todoist half skipped (no resolved project) but
      // does not block the GitHub half: it falls back to the pre-reconcile
      // archive signal, preserving the halves' error isolation.
      return {
        todoistProjectId: null,
        frozen: note.archivedAt !== null || (boardState?.closed ?? false),
        notePath: note.path,
        archivedAt: note.archivedAt,
      };
    }
  }

  private async runGithubHalf(
    project: string,
    boardState: ProjectStateData | undefined,
    verdict: ProjectLifecycleVerdict,
    syncedAt: string,
  ): Promise<void> {
    // A project without a probed GitHub state has no board to sweep; a frozen
    // project (archived) accepts no task writes.
    if (!boardState || verdict.frozen) {
      return;
    }

    const lastUpdate = await this.syncState.getLastProjectUpdate(project);
    // The board's updatedAt is the probe gate, but a sub-issue relation moves
    // nothing on the board. A project carrying a one-shot marker forces exactly
    // one parent-aware fetch. The marker is PEEKED here and CONSUMED only after
    // the fetch succeeds, so a failed or interrupted half does not spend the
    // scan and the next tick retries it.
    const fullScanPending = await this.syncState.isFullScanPending(project);
    const includeBoard = boardState.updatedAt !== lastUpdate || fullScanPending;
    try {
      await this.syncGithubTasks.execute({
        projectName: project,
        syncedAt,
        includeBoard,
      });
      await this.syncState.setLastProjectUpdate(project, boardState.updatedAt);
      if (fullScanPending) {
        await this.syncState.consumeFullScan(project);
      }
    } catch (error) {
      // A failed half must not advance the stored update, so the next tick
      // sees the same updatedAt and retries the fetch.
      console.error(
        `SyncProjectAction: github half failed for ${project}`,
        error,
      );
    }
  }

  // The vault-side consistency pass: the checklist line and its to-do notes
  // converge in both directions. It is deliberately independent of the GitHub
  // verdict — a checklist edit is a vault change that must promote/complete
  // its to-dos even when the GitHub half writes nothing. The dt-13 cascade runs
  // here first, so a task whose done status arrived from ANY origin (a GitHub
  // close, a Todoist check, a vault edit) completes its to-dos; the writer
  // itself cascades on the GitHub pull path.
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
    }
  }
}
