import { Component } from 'obsidian';
import type { VaultPort } from '../../core/port/VaultPort.js';
import type { SyncQueue } from './SyncQueue.js';

interface BrowserTimers {
  setInterval(callback: () => void, ms?: number): number;
  setTimeout(callback: () => void, ms?: number): number;
  clearTimeout(id: number): void;
}

declare const window: BrowserTimers;

export class SyncScheduler extends Component {
  private readonly debounceTimers = new Map<string, number>();

  constructor(
    private readonly vault: VaultPort,
    private readonly queue: SyncQueue,
    private readonly intervalMs: number,
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
        this.schedule(projectName);
      }
    });

    this.vault.onNoteDeleted((path) => {
      const projectName = this.projectNameFromPath(path);
      if (projectName) {
        this.schedule(projectName);
      }
    });

    this.vault.onNoteRenamed((_oldPath, newPath) => {
      const projectName = this.projectNameFromPath(newPath);
      if (projectName) {
        this.queue.enqueue(projectName);
      }
    });
  }

  private async tick(): Promise<void> {
    const notes = await this.vault.findProjectNotes();
    for (const note of notes) {
      this.queue.enqueue(note.projectName);
    }
  }

  private projectNameFromPath(path: string): string | null {
    const segments = path.split('/');
    if (segments[0] !== 'Projecten' || segments.length < 3) {
      return null;
    }
    return segments[1] ?? null;
  }

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
