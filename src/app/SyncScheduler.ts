import { Component } from 'obsidian';
import type { NoteEnumeratorPort } from '../core/ports/NoteEnumeratorPort.js';
import type { VaultEventPort } from '../core/ports/VaultEventPort.js';
import type { SyncQueue } from './SyncQueue.js';

// Obsidian runs in a browser where window is the global; the node type
// environment does not declare it as a value. Declare just the timers we use
// so window.setInterval/setTimeout return numbers (as in the browser) for
// registerInterval and the debounce bookkeeping.
declare const window: {
  setInterval(callback: () => void, ms?: number): number;
  setTimeout(callback: () => void, ms?: number): number;
  clearTimeout(id: number): void;
};

// Delivery mechanics only: turns a timer and vault note changes/deletions/
// renames into queue enqueues. Zero business decisions — the queue, interval
// and debounce are injected. A poll tick discovers every pm-project and
// enqueues it; a note change or deletion debounces per project; a rename
// enqueues immediately (coalescing would drop intermediate old-paths and
// strand links). The chain re-resolves the project from the vault, so a stale
// work item is safe.
export class SyncScheduler extends Component {
  private readonly debounceTimers = new Map<string, number>();

  constructor(
    private readonly vault: VaultEventPort & NoteEnumeratorPort,
    private readonly queue: SyncQueue,
    private readonly intervalMs: number,
    private readonly debounceMs: number,
    // A global pre-tick hook: the plugin wires the remote-project capture here
    // so a project born on a remote becomes a vault project before the
    // tick enumerates them (PRJ-2/PRJ-3). The scheduler makes no decision about
    // what it does — it invokes the injected action and enqueues what it
    // returns. Optional so a scheduler assembled without the project wave
    // still constructs.
    private readonly captureProjects?: () => Promise<string[]>,
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
        this.schedule(projectName);
      }
    });

    this.vault.onNoteDeleted((path) => {
      const projectName = this.projectNameFromPath(path);
      if (projectName) {
        this.schedule(projectName);
      }
    });

    // A rename bypasses the debounce: coalescing would drop intermediate
    // old-paths and strand links.
    this.vault.onNoteRenamed((_oldPath, newPath) => {
      const projectName = this.projectNameFromPath(newPath);
      if (projectName) {
        this.queue.enqueue(projectName);
      }
    });
  }

  // Discovery: every pm-project is enqueued; the chain gates the remote half
  // itself. The pre-tick capture runs first so a remote-born project exists as a
  // vault project before the enumeration; its names are enqueued explicitly
  // because a freshly created note may not be visible to the metadata cache
  // within the same tick.
  private async tick(): Promise<void> {
    let captured: string[] = [];
    if (this.captureProjects) {
      try {
        captured = await this.captureProjects();
      } catch (error) {
        // A capture failure must never stop the tick's normal work.
        console.error('SyncScheduler: project capture failed', error);
      }
    }
    const notes = await this.vault.findProjectNotes();
    for (const note of notes) {
      this.queue.enqueue(note.projectName);
    }
    for (const projectName of captured) {
      this.queue.enqueue(projectName);
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

  // Debounces per project: a modify and a delete for the same project coalesce
  // into one enqueue (the chain re-resolves and sweeps both).
  private schedule(projectName: string): void {
    const existing = this.debounceTimers.get(projectName);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(projectName);
      this.queue.enqueue(projectName);
    }, this.debounceMs);
    this.debounceTimers.set(projectName, timer);
  }
}
