import { Component } from 'obsidian';
import type { SyncProjectAction } from '../../Domain/Actions/SyncProjectAction.js';

// Obsidian runs in a browser where window is the global; the node type
// environment does not declare it as a value. Declare just the timer we use
// so window.setInterval returns a number (as in the browser) for
// registerInterval.
declare const window: {
  setInterval(callback: () => void, ms?: number): number;
};

// Delivery mechanics only: turns a timer into a per-project sync invocation.
// Zero decisions — the action, project list and interval are injected. Vault
// event subscription arrives in a later ticket.
export class SyncScheduler extends Component {
  constructor(
    private readonly syncProject: SyncProjectAction,
    private readonly projectNames: string[],
    private readonly intervalMs: number,
  ) {
    super();
  }

  override onload(): void {
    this.registerInterval(
      window.setInterval(() => {
        void this.tick();
      }, this.intervalMs),
    );
  }

  private async tick(): Promise<void> {
    for (const projectName of this.projectNames) {
      const syncedAt = new Date().toISOString();
      await this.syncProject.execute({ projectName, syncedAt });
    }
  }
}
