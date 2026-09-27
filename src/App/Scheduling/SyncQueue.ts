import type { SyncProjectAction } from '../../Domain/Actions/SyncProjectAction.js';

// Delivery mechanics: one serialized promise chain for the whole plugin. Every
// trigger enqueues a project name; the queue runs one project at a time, in
// order. Coalescing: a project already waiting absorbs a duplicate enqueue; a
// project currently running lets the duplicate queue behind it (the running run
// may have started before the change that triggered the duplicate). A failed
// run is swallowed so it can never poison the queue — the next item still runs.
// No per-project keys: the queue is a single chain, not a map of chains.
export class SyncQueue {
  private readonly pending: string[] = [];
  private draining = false;
  private idleResolvers: Array<() => void> = [];

  constructor(private readonly syncProject: SyncProjectAction) {}

  enqueue(project: string): void {
    // A pending item absorbs the duplicate; a running one is not pending, so
    // the duplicate queues behind it.
    if (this.pending.includes(project)) {
      return;
    }
    this.pending.push(project);
    void this.drain();
  }

  // Resolves once the queue has drained. A test seam; the trigger layer never
  // awaits it.
  whenIdle(): Promise<void> {
    if (!this.draining && this.pending.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const project = this.pending.shift() as string;
        try {
          await this.syncProject.execute(project);
        } catch {
          // A failed run must not poison the queue: the next item still runs.
        }
      }
    } finally {
      this.draining = false;
      const resolvers = this.idleResolvers;
      this.idleResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }
}
