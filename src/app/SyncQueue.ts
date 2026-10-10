import type { SyncProjectAction } from '../domain/actions/SyncProjectAction.js';

export class SyncQueue {
  private readonly pending: string[] = [];
  private draining = false;
  private idleResolvers: Array<() => void> = [];

  constructor(
    private readonly syncProject: SyncProjectAction,
    private readonly onErrors?: (project: string, errors: unknown[]) => void,
  ) {}

  enqueue(project: string): void {
    if (this.pending.includes(project)) {
      return;
    }
    this.pending.push(project);
    void this.drain();
  }

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
          const errors = await this.syncProject.execute(project);
          if (errors.length > 0) {
            this.onErrors?.(project, errors);
          }
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
