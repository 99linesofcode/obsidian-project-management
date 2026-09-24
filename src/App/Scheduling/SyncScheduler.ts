import { Component } from 'obsidian';
import type { HandleDeletedNoteAction } from '../../Domain/Actions/HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from '../../Domain/Actions/MirrorTodoStatusAction.js';
import type { ProbeProjectsAction } from '../../Domain/Actions/ProbeProjectsAction.js';
import type { ReconcileTaskAction } from '../../Domain/Actions/ReconcileTaskAction.js';
import type { RelinkRenamedTodoAction } from '../../Domain/Actions/RelinkRenamedTodoAction.js';
import type { RelocateTaskStatusAction } from '../../Domain/Actions/RelocateTaskStatusAction.js';
import type { SyncChecklistAction } from '../../Domain/Actions/SyncChecklistAction.js';
import type { SyncProjectAction } from '../../Domain/Actions/SyncProjectAction.js';
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

// The work a trigger asks for. A rename carries both paths; every other kind
// carries the single path that changed.
type SyncTrigger =
  | { kind: 'reconcile' | 'delete' | 'mirror'; path: string }
  | { kind: 'renamed'; oldPath: string; newPath: string };

// Delivery mechanics only: turns a timer and vault note changes/deletions/
// renames into per-project sync invocations. Zero business decisions — the
// actions, project list, interval and debounce are injected; the only choice
// made here is gating the board fetch on the probed updatedAt. Note changes
// and deletions are debounced per project and serialised per project (a
// promise chain per project name), so a poll tick and an edit-triggered
// reconcile never overlap for the same project. A rename bypasses the
// debounce but still serialises.
export class SyncScheduler extends Component {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly debounceTimers = new Map<string, number>();
  private projectNames: string[];

  constructor(
    private readonly syncProject: SyncProjectAction,
    private readonly probeProjects: ProbeProjectsAction,
    private readonly syncState: SyncStatePort,
    projectNames: string[],
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
    this.projectNames = projectNames;
  }

  // Discovery runs asynchronously after layout is ready, so the project list
  // is populated once the vault's project notes are known.
  setProjectNames(projectNames: string[]): void {
    this.projectNames = projectNames;
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

  // Two-tier poll: one cheap fleet probe reads every project's updatedAt, then
  // the expensive board fetch runs only for projects whose updatedAt moved
  // since their last successful sync. The tracked-issue reconcile runs every
  // tick regardless. The stored update advances only after a successful sync,
  // so a failed sync retries the board fetch on the next tick.
  private async tick(): Promise<void> {
    const states = await this.probeProjects.execute(this.projectNames);

    for (const projectName of this.projectNames) {
      const state = states.get(projectName);
      if (!state) {
        continue;
      }

      const syncedAt = new Date().toISOString();
      const lastUpdate = await this.syncState.getLastProjectUpdate(projectName);
      const includeBoard = state.updatedAt !== lastUpdate;

      try {
        await this.syncProject.execute({ projectName, syncedAt, includeBoard });
        await this.syncState.setLastProjectUpdate(projectName, state.updatedAt);
      } catch {
        // A failed sync must not advance the stored update, so the next tick
        // sees the same updatedAt and retries the board fetch.
      }
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
    const next = previous.then(() => this.run(projectName, trigger));
    this.chains.set(projectName, next);
  }

  private async run(projectName: string, trigger: SyncTrigger): Promise<void> {
    const syncedAt = new Date().toISOString();
    if (trigger.kind === 'delete') {
      return this.handleDeletedNote.execute({
        notePath: trigger.path,
        projectName,
      });
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
