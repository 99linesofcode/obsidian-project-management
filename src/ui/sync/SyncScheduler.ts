import { Component } from 'obsidian';
import { projectFolderFromNotePath } from '../../core/domain/paths.js';
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
      this.scheduleProject(path);
    });

    this.vault.onNoteDeleted((path) => {
      this.scheduleProject(path);
    });

    this.vault.onNoteRenamed((_oldPath, newPath) => {
      const folder = projectFolderFromNotePath(newPath);
      if (folder !== null) {
        this.queue.enqueue(folder);
      }
    });
  }

  private async tick(): Promise<void> {
    for (const note of await this.vault.findProjectNotes()) {
      const folder = projectFolderFromNotePath(note.path);
      if (folder !== null) {
        this.queue.enqueue(folder);
      }
    }
  }

  private scheduleProject(path: string): void {
    const folder = projectFolderFromNotePath(path);
    if (folder !== null) {
      this.schedule(folder);
    }
  }

  private schedule(folder: string): void {
    const existing = this.debounceTimers.get(folder);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(folder);
      this.queue.enqueue(folder);
    }, this.debounceMs);
    this.debounceTimers.set(folder, timer);
  }
}
