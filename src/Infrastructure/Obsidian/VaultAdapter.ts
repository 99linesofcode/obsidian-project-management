import { App, TFile } from 'obsidian';
import type { VaultPort } from '../../Domain/Ports/VaultPort.js';

// Implements the vault port against Obsidian's vault. Renames go through
// app.fileManager.renameFile so backlinks update; writes use modify on an
// existing file and create otherwise.
export class VaultAdapter implements VaultPort {
  constructor(private readonly app: App) {}

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
}
