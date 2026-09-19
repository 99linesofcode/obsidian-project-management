import { App, EventRef, TFile } from 'obsidian';
import type { VaultPort } from '../../Domain/Ports/VaultPort.js';

// Registers an Obsidian event ref for cleanup when the plugin unloads. The
// plugin's registerEvent is injected so the adapter stays decoupled from it.
export type EventRegistrar = (eventRef: EventRef) => void;

// Implements the vault port against Obsidian's vault. Renames go through
// app.fileManager.renameFile so backlinks update; writes use modify on an
// existing file and create otherwise.
export class VaultAdapter implements VaultPort {
  constructor(
    private readonly app: App,
    private readonly registerEvent: EventRegistrar,
  ) {}

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }

    const content = await this.app.vault.read(file);
    return { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }

  async writeNote(path: string, content: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(oldPath);
    if (file instanceof TFile) {
      await this.app.fileManager.renameFile(file, newPath);
    }
  }

  onNoteChanged(cb: (path: string) => void): void {
    // Only task notes under Projecten/ are synced; everything else is ignored.
    const eventRef = this.app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.extension === 'md' && file.path.startsWith('Projecten/')) {
        cb(file.path);
      }
    });
    this.registerEvent(eventRef);
  }
}
