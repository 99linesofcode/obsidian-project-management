import type { ProjectNoteData } from '../DataTransferObjects/ProjectNoteData.js';
import type { ProjectStateData } from '../DataTransferObjects/ProjectStateData.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { DetectNoteRenamesAction } from './DetectNoteRenamesAction.js';
import type { HandleDeletedNoteAction } from './HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from './MirrorTodoStatusAction.js';
import type { ProbeProjectsAction } from './ProbeProjectsAction.js';
import type {
  ProjectLifecycleVerdict,
  ReconcileProjectLifecycleAction,
} from './ReconcileProjectLifecycleAction.js';
import type { SyncChecklistAction } from './SyncChecklistAction.js';
import type { CompleteTaskCascadeAction } from './CompleteTaskCascadeAction.js';
import type { SyncGithubTasksAction } from './SyncGithubTasksAction.js';
import type { SyncTodoistTasksAction } from './SyncTodoistTasksAction.js';

// THE CHAIN: one work item kind — a project folder name — and one entry point.
// The chain re-resolves the project from the vault, so a stale work item (a
// renamed-away project) no-ops and project-level deletion is never propagated
// from a stale item. Steps compose the halves; each step is isolated, so a
// failure logs and skips that step and the GitHub half failing never blocks the
// Todoist half (or vice versa). Snapshots and cursors advance only on success,
// preserved by the underlying actions.
//
//   1. resolve project (inline) — pm-note exists? else no-op
//   2. reconcile lifecycle — ONE freeze verdict (folder ⇄ archive ⇄ Todoist)
//   3. renames — DetectNoteRenamesAction (snapshot drift)
//   4. GitHub half — probe → SyncGithubTasks (single-query canonical pipeline)
//   5. vault consistency — checklist ↔ to-do (retained; verdict-independent)
//   6. Todoist half — SyncTodoistTasks (canonical pipeline; gated by the verdict)
//   7. deletions last — status records whose note is gone
//
// The probe is hoisted to the top of the GitHub-side work because the lifecycle
// gate needs the probed `closed` state; one probe serves both.
export class SyncProjectAction {
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

    // 2. Lifecycle — one freeze verdict for both halves. A failure leaves the
    // project frozen for this tick so no task write runs against an unknown
    // state; the next tick retries.
    const verdict = await this.runLifecycle(project, note, state, syncedAt);

    // 3. Renames.
    await this.step('renames', () =>
      this.detectNoteRenames.execute({ projectName: project, syncedAt }),
    );

    // 4. GitHub half (canonical pipeline).
    await this.step('github half', () =>
      this.runGithubHalf(project, state, verdict, syncedAt),
    );

    // 5. Vault consistency — checklist ↔ to-do. Retained as its own step
    // because it must run for every task note regardless of the GitHub
    // verdict; the vault writer's surface covers the note body it writes.
    await this.step('vault consistency', () =>
      this.runVaultConsistency(project, syncedAt),
    );

    // 6. Todoist half — gated by the freeze verdict. The lifecycle resolved the
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

    // 7. Deletions last.
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

  private async runLifecycle(
    project: string,
    note: ProjectNoteData,
    state: ProjectStateData | undefined,
    syncedAt: string,
  ): Promise<ProjectLifecycleVerdict> {
    try {
      return await this.reconcileProjectLifecycle.execute({
        projectName: project,
        notePath: note.path,
        locationArchived: note.archived,
        syncedAt,
        ...(state === undefined ? {} : { closed: state.closed }),
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
        frozen: note.archived || (state?.closed ?? false),
        notePath: note.path,
        locationArchived: note.archived,
      };
    }
  }

  private async runGithubHalf(
    project: string,
    state: ProjectStateData | undefined,
    verdict: ProjectLifecycleVerdict,
    syncedAt: string,
  ): Promise<void> {
    // A project without a probed GitHub state has no board to sweep; a frozen
    // project (archived) accepts no task writes.
    if (!state || verdict.frozen) {
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
