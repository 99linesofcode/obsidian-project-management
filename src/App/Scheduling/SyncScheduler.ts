import { Component } from 'obsidian';
import type { HandleDeletedNoteAction } from '../../Domain/Actions/HandleDeletedNoteAction.js';
import type { ReconcileTaskAction } from '../../Domain/Actions/ReconcileTaskAction.js';
import type { SyncProjectAction } from '../../Domain/Actions/SyncProjectAction.js';
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

// Delivery mechanics only: turns a timer and vault note changes/deletions
// into per-project sync invocations. Zero decisions — the actions, project
// list, interval and debounce are injected. Note changes and deletions are
// debounced per project and serialised per project (a promise chain per
// project name), so a poll tick and an edit-triggered reconcile never overlap
// for the same project.
export class SyncScheduler extends Component {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly debounceTimers = new Map<string, number>();
  private projectNames: string[];

  constructor(
    private readonly syncProject: SyncProjectAction,
    projectNames: string[],
    private readonly intervalMs: number,
    private readonly vault: VaultPort,
    private readonly reconcileTask: ReconcileTaskAction,
    private readonly handleDeletedNote: HandleDeletedNoteAction,
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
        this.schedule('reconcile', projectName, path);
      }
    });

    this.vault.onNoteDeleted((path) => {
      const projectName = this.projectNameFromPath(path);
      if (projectName) {
        this.schedule('delete', projectName, path);
      }
    });
  }

  private async tick(): Promise<void> {
    for (const projectName of this.projectNames) {
      const syncedAt = new Date().toISOString();
      await this.syncProject.execute({ projectName, syncedAt });
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

  // Debounces per project and per kind, so a modify and a delete for the same
  // project don't coalesce into one action; both still serialise on the same
  // per-project chain.
  private schedule(kind: 'reconcile' | 'delete', projectName: string, path: string): void {
    const key = `${kind}:${projectName}`;
    const existing = this.debounceTimers.get(key);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(key);
      this.enqueue(kind, projectName, path);
    }, this.debounceMs);
    this.debounceTimers.set(key, timer);
  }

  private enqueue(kind: 'reconcile' | 'delete', projectName: string, path: string): void {
    const previous = this.chains.get(projectName) ?? Promise.resolve();
    const next = previous.then(() => {
      if (kind === 'delete') {
        return this.handleDeletedNote.execute({ notePath: path });
      }
      return this.reconcileTask.execute({
        notePath: path,
        projectName,
        syncedAt: new Date().toISOString(),
      });
    });
    this.chains.set(projectName, next);
  }
}
