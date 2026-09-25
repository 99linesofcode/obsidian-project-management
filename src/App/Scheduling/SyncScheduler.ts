import { Component } from 'obsidian';
import type { ApplyTodoistCompletionAction } from '../../Domain/Actions/ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from '../../Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from '../../Domain/Actions/CaptureTodoistCreationsAction.js';
import type { HandleDeletedNoteAction } from '../../Domain/Actions/HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from '../../Domain/Actions/MirrorTodoStatusAction.js';
import type { ProbeProjectsAction } from '../../Domain/Actions/ProbeProjectsAction.js';
import type { ProjectTasksToTodoistAction } from '../../Domain/Actions/ProjectTasksToTodoistAction.js';
import type { ProjectToDosToTodoistAction } from '../../Domain/Actions/ProjectToDosToTodoistAction.js';
import type { PropagateTodoistDeletionsAction } from '../../Domain/Actions/PropagateTodoistDeletionsAction.js';
import type { ReconcileArchiveStateAction } from '../../Domain/Actions/ReconcileArchiveStateAction.js';
import type { ReconcileTaskAction } from '../../Domain/Actions/ReconcileTaskAction.js';
import type { ReconcileTodoistProjectAction } from '../../Domain/Actions/ReconcileTodoistProjectAction.js';
import type { RelinkRenamedTodoAction } from '../../Domain/Actions/RelinkRenamedTodoAction.js';
import type { RelocateTaskStatusAction } from '../../Domain/Actions/RelocateTaskStatusAction.js';
import type { SyncChecklistAction } from '../../Domain/Actions/SyncChecklistAction.js';
import type { SyncProjectAction } from '../../Domain/Actions/SyncProjectAction.js';
import type { WatchArchivedProjectAction } from '../../Domain/Actions/WatchArchivedProjectAction.js';
import type { SyncStatePort } from '../../Domain/Ports/SyncStatePort.js';
import type { VaultPort } from '../../Domain/Ports/VaultPort.js';

// Obsidian runs in a browser where window is the global; the node type
// environment does not declare it as a value. Declare just the timers we use
// so window.setInterval/setTimeout return numbers (as in the browser) for
// registerInterval and the debounce bookkeeping.
declare const window: {
  setInterval(callback: () => void, ms?: number): number;
  setTimeout(callback: () => void, ms?: number): number;
  clearTimeout(id: number): void;
};

// The work a trigger asks for. A rename carries both paths; a tick carries the
// project note's path, the location-derived archived flag, whether the project
// has a probed GitHub state, and the probed remote state; every other kind
// carries the single path that changed.
type SyncTrigger =
  | { kind: 'reconcile' | 'delete' | 'mirror'; path: string }
  | { kind: 'renamed'; oldPath: string; newPath: string }
  | {
      kind: 'tick';
      notePath: string;
      locationArchived: boolean;
      hasGithub: boolean;
      closed: boolean;
      updatedAt: string;
      syncedAt: string;
    };

// Delivery mechanics only: turns a timer and vault note changes/deletions/
// renames into per-project sync invocations. Zero business decisions — the
// actions, interval and debounce are injected; the only choices made here are
// deriving each project's archived flag from its note location and gating the
// board fetch on the probed updatedAt. Note changes and deletions are debounced
// per project and serialised per project (a promise chain per project name), so
// a poll tick and an edit-triggered reconcile never overlap for the same
// project. A rename bypasses the debounce but still serialises.
export class SyncScheduler extends Component {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly debounceTimers = new Map<string, number>();

  constructor(
    private readonly syncProject: SyncProjectAction,
    private readonly probeProjects: ProbeProjectsAction,
    private readonly reconcileArchiveState: ReconcileArchiveStateAction,
    private readonly reconcileTodoistProject: ReconcileTodoistProjectAction,
    private readonly applyTodoistRemoteChanges: ApplyTodoistRemoteChangesAction,
    private readonly captureTodoistCreations: CaptureTodoistCreationsAction,
    private readonly projectTasksToTodoist: ProjectTasksToTodoistAction,
    private readonly applyTodoistCompletion: ApplyTodoistCompletionAction,
    private readonly projectToDosToTodoist: ProjectToDosToTodoistAction,
    private readonly propagateTodoistDeletions: PropagateTodoistDeletionsAction,
    private readonly watchArchivedProject: WatchArchivedProjectAction,
    private readonly syncState: SyncStatePort,
    private readonly intervalMs: number,
    private readonly vault: VaultPort,
    private readonly syncChecklist: SyncChecklistAction,
    private readonly mirrorTodoStatus: MirrorTodoStatusAction,
    private readonly reconcileTask: ReconcileTaskAction,
    private readonly handleDeletedNote: HandleDeletedNoteAction,
    private readonly relinkRenamedTodo: RelinkRenamedTodoAction,
    private readonly relocateTaskStatus: RelocateTaskStatusAction,
    private readonly debounceMs: number,
  ) {
    super();
  }

  override onload(): void {
    this.registerInterval(
      window.setInterval(() => {
        void this.tick();
      }, this.intervalMs),
    );

    this.vault.onNoteChanged((path) => {
      const projectName = this.projectNameFromPath(path);
      if (projectName) {
        this.schedule(this.kindFor(path), projectName, path);
      }
    });

    this.vault.onNoteDeleted((path) => {
      const projectName = this.projectNameFromPath(path);
      if (projectName) {
        this.schedule('delete', projectName, path);
      }
    });

    // A rename bypasses the debounce: coalescing would drop intermediate
    // old-paths and strand links. It still serialises on the per-project chain.
    this.vault.onNoteRenamed((oldPath, newPath) => {
      const projectName = this.projectNameFromPath(newPath);
      if (projectName) {
        this.enqueue(projectName, { kind: 'renamed', oldPath, newPath });
      }
    });
  }

  // Two-tier poll: one cheap fleet probe reads every project's updatedAt and
  // closed flag, then the expensive board fetch runs only for active projects
  // whose updatedAt moved since their last successful sync. The project list is
  // derived fresh each tick from the notes' locations — a note under Archief/
  // is archived, one under Projecten/ is active — so a folder move is picked up
  // without any stored flag. Every project is reconciled first through the
  // baseline merge (the vault wins a conflict), then only active projects sync;
  // archived projects are frozen but watched, so a new issue re-activates them.
  // The stored update advances only after a successful sync, so a failed sync
  // retries the board fetch on the next tick.
  //
  // Every discovered pm-note gets a tick, not only the probed ones: a
  // pm-marked project whose GitHub identity has not resolved still mirrors
  // to Todoist (dt-03), so it is enqueued with hasGithub false and the
  // GitHub half skips it. Notes without a pm property are never discovered
  // and never sync anywhere.
  private async tick(): Promise<void> {
    const notes = await this.vault.findProjectNotes();
    const active = new Set<string>();
    const archived = new Set<string>();
    const noteByProject = new Map<string, (typeof notes)[number]>();
    for (const note of notes) {
      (note.archived ? archived : active).add(note.projectName);
      noteByProject.set(note.projectName, note);
    }
    const projectNames = [...new Set([...active, ...archived])];

    const states = await this.probeProjects.execute(projectNames);

    for (const projectName of projectNames) {
      const note = noteByProject.get(projectName);
      if (!note) {
        continue;
      }
      const state = states.get(projectName);
      this.enqueue(projectName, {
        kind: 'tick',
        notePath: note.path,
        locationArchived: archived.has(projectName),
        hasGithub: state !== undefined,
        closed: state?.closed ?? false,
        updatedAt: state?.updatedAt ?? '',
        syncedAt: new Date().toISOString(),
      });
    }
  }

  private projectNameFromPath(path: string): string | null {
    // Task notes live at Projecten/<project>/taken/<id>-<slug>.md
    const segments = path.split('/');
    if (segments[0] !== 'Projecten' || segments.length < 3) {
      return null;
    }
    return segments[1] ?? null;
  }

  // A to-do note change mirrors onto its parent task note; every other
  // Projecten change goes through the reconcile path.
  private kindFor(path: string): 'reconcile' | 'mirror' {
    return path.includes('/todos/') ? 'mirror' : 'reconcile';
  }

  // Debounces per project and per kind, so a modify and a delete for the same
  // project don't coalesce into one action; both still serialise on the same
  // per-project chain.
  private schedule(
    kind: 'reconcile' | 'delete' | 'mirror',
    projectName: string,
    path: string,
  ): void {
    const key = `${kind}:${projectName}`;
    const existing = this.debounceTimers.get(key);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(key);
      this.enqueue(projectName, { kind, path });
    }, this.debounceMs);
    this.debounceTimers.set(key, timer);
  }

  private enqueue(projectName: string, trigger: SyncTrigger): void {
    const previous = this.chains.get(projectName) ?? Promise.resolve();
    // A failed run must not poison the chain: the next trigger still runs.
    const next = previous
      .then(() => this.run(projectName, trigger))
      .catch(() => {});
    this.chains.set(projectName, next);
  }

  private async run(projectName: string, trigger: SyncTrigger): Promise<void> {
    const syncedAt = new Date().toISOString();
    if (trigger.kind === 'tick') {
      return this.runTick(projectName, trigger);
    }
    if (trigger.kind === 'delete') {
      // The Todoist twin is deleted whatever the GitHub handler's outcome: the
      // sweep is independent, and isolating it keeps a GitHub failure from
      // stranding the twin until the next tick.
      try {
        await this.handleDeletedNote.execute({
          notePath: trigger.path,
          projectName,
        });
      } finally {
        await this.propagateTodoistDeletions.execute({ projectName });
      }
      return;
    }
    if (trigger.kind === 'mirror') {
      return this.mirrorTodoStatus.execute({
        todoPath: trigger.path,
        syncedAt,
      });
    }
    if (trigger.kind === 'renamed') {
      return this.relocateRenamed(trigger.oldPath, trigger.newPath, syncedAt);
    }
    return this.reconcileTaskNote(trigger.path, projectName, syncedAt);
  }

  // A tick runs the GitHub half and the Todoist half. The GitHub half reconciles
  // the archive state first through the baseline merge (the vault wins a
  // conflict), then routes by the project's location: an archived project is
  // frozen — no issue reconcile, no board fetch — but its repository is
  // watched, so a new issue re-activates it; a project whose board was closed
  // is transitioned this tick and synced on the next one, once the probe sees
  // the reopened board. The Todoist half then mirrors the project lifecycle
  // (ensure, rename, archive/unarchive) and runs for every project, including
  // archived ones and ones without a GitHub attach. It is isolated: a Todoist
  // failure is caught so it can never break the GitHub half. The transition,
  // the watch, the sync and the mirror ride the same per-project chain, so they
  // never interleave.
  private async runTick(
    projectName: string,
    trigger: Extract<SyncTrigger, { kind: 'tick' }>,
  ): Promise<void> {
    try {
      await this.runGithubHalf(projectName, trigger);
    } finally {
      await this.runTodoistHalf(projectName, trigger);
    }
  }

  private async runGithubHalf(
    projectName: string,
    trigger: Extract<SyncTrigger, { kind: 'tick' }>,
  ): Promise<void> {
    // A project without a probed GitHub state has no board to reconcile; the
    // Todoist half still mirrors it.
    if (!trigger.hasGithub) {
      return;
    }
    await this.reconcileArchiveState.execute({
      projectName,
      locationArchived: trigger.locationArchived,
      closed: trigger.closed,
      syncedAt: trigger.syncedAt,
    });
    if (trigger.locationArchived) {
      return this.watchArchivedProject.execute({
        projectName,
        syncedAt: trigger.syncedAt,
      });
    }
    if (trigger.closed) {
      return;
    }

    const lastUpdate = await this.syncState.getLastProjectUpdate(projectName);
    const includeBoard = trigger.updatedAt !== lastUpdate;
    try {
      await this.syncProject.execute({
        projectName,
        syncedAt: trigger.syncedAt,
        includeBoard,
      });
      await this.syncState.setLastProjectUpdate(projectName, trigger.updatedAt);
    } catch {
      // A failed sync must not advance the stored update, so the next tick
      // sees the same updatedAt and retries the board fetch.
    }
  }

  // The Todoist half of the tick: mirror the project's lifecycle, then absorb
  // the remote side into the vault, then project the vault's tasks and their
  // to-dos. The lifecycle action returns the project id when the project is
  // active and null when it is frozen-archived, so the freeze gates the whole
  // reconcile too (dt-10). Remote absorption comes first (t5): the snapshot
  // verdicts and captured creations land in the vault before any projection
  // pushes, so a remote change is never clobbered by a vault-side push — the
  // same apply-before-project invariant t4 established for completions. The
  // to-do completion pull then runs before the to-do projection for the same
  // reason. Deletion propagation closes the tick (t6, spec step 7): twins whose
  // notes are gone are removed after the projections, and the action deletes
  // each twin before evicting its record, so a deleted note's twin never
  // lingers into the next tick's capture pass. A failure is swallowed so the
  // GitHub half's outcome is never affected; the next tick retries.
  private async runTodoistHalf(
    projectName: string,
    trigger: Extract<SyncTrigger, { kind: 'tick' }>,
  ): Promise<void> {
    try {
      const projectId = await this.reconcileTodoistProject.execute({
        projectName,
        notePath: trigger.notePath,
        locationArchived: trigger.locationArchived,
        syncedAt: trigger.syncedAt,
      });
      if (projectId === null) {
        return;
      }
      await this.applyTodoistRemoteChanges.execute({
        projectName,
        projectId,
        syncedAt: trigger.syncedAt,
      });
      await this.captureTodoistCreations.execute({
        projectName,
        projectId,
        syncedAt: trigger.syncedAt,
      });
      await this.projectTasksToTodoist.execute({
        projectName,
        projectId,
        syncedAt: trigger.syncedAt,
      });
      await this.applyTodoistCompletion.execute({
        projectName,
        projectId,
        syncedAt: trigger.syncedAt,
      });
      await this.projectToDosToTodoist.execute({
        projectName,
        projectId,
        syncedAt: trigger.syncedAt,
      });
      // Deletion propagation runs last (spec reconcile step 7): the vault-side
      // projections have already pushed their state, and the twin-then-record
      // ordering inside the action keeps an evicted anchor from resurrecting.
      await this.propagateTodoistDeletions.execute({ projectName });
    } catch {
      // A Todoist failure must never break the GitHub half.
    }
  }

  // A rename is routed by the note's new path: a to-do relinks its parent line,
  // a task note moves its Status record. Any other Projecten path is ignored.
  private async relocateRenamed(
    oldPath: string,
    newPath: string,
    syncedAt: string,
  ): Promise<void> {
    if (newPath.includes('/todos/')) {
      return this.relinkRenamedTodo.execute({ oldPath, newPath, syncedAt });
    }
    if (newPath.includes('/taken/')) {
      return this.relocateTaskStatus.execute({ oldPath, newPath });
    }
  }

  // A task note's checklist is synced first so the body the reconcile pushes
  // carries the to-do links. The checklist sync may rewrite the note, which
  // re-fires this trigger; that second pass is a no-op (the sync settles), so
  // the chain always comes to rest. Any other Projecten note skips the
  // checklist sync and reconciles directly.
  private async reconcileTaskNote(
    notePath: string,
    projectName: string,
    syncedAt: string,
  ): Promise<void> {
    if (notePath.includes('/taken/')) {
      await this.syncChecklist.execute({ notePath, projectName, syncedAt });
    }
    await this.reconcileTask.execute({ notePath, projectName, syncedAt });
  }
}
