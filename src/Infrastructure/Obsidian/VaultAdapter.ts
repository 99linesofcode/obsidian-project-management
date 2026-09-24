import { App, EventRef, TFile } from 'obsidian';
import type { ProjectNoteData } from '../../Domain/DataTransferObjects/ProjectNoteData.js';
import type { VaultPort } from '../../Domain/Ports/VaultPort.js';
import { folderChainForPath } from './folderChainForPath.js';
import { projectNoteFromCache } from './projectNoteFromCache.js';

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
    // Obsidian's create throws when the parent folder is missing, so build
    // the folder chain first (mkdir -p semantics), then create the note.
    for (const folder of folderChainForPath(path)) {
      if (!this.app.vault.getFolderByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
    }

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

  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => file.path);
  }

  async trashNote(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      // system: false keeps the file in the vault-internal .trash, recoverable.
      await this.app.vault.trash(file, false);
    }
  }

  async findProjectNotes(): Promise<ProjectNoteData[]> {
    // Reads each markdown file's frontmatter cache (no full-file reads) and
    // keeps only the notes that declare a pm property.
    const notes: ProjectNoteData[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const note = projectNoteFromCache(file.path, cache?.frontmatter);
      if (note) {
        notes.push(note);
      }
    }
    return notes;
  }

  onNoteChanged(cb: (path: string) => void): void {
    // Only task notes under Projecten/ are synced; everything else is ignored.
    // Both modify and create are watched: a note the plugin materialises during
    // a poll tick fires 'create', not 'modify', and must enter the same chain.
    const handler = (file: unknown): void => {
      if (
        file instanceof TFile &&
        file.extension === 'md' &&
        file.path.startsWith('Projecten/')
      ) {
        cb(file.path);
      }
    };
    this.registerEvent(this.app.vault.on('modify', handler));
    this.registerEvent(this.app.vault.on('create', handler));
  }

  onNoteDeleted(cb: (path: string) => void): void {
    // Only task notes under Projecten/ are synced; everything else is ignored.
    const eventRef = this.app.vault.on('delete', (file) => {
      if (
        file instanceof TFile &&
        file.extension === 'md' &&
        file.path.startsWith('Projecten/')
      ) {
        cb(file.path);
      }
    });
    this.registerEvent(eventRef);
  }

  onNoteRenamed(cb: (oldPath: string, newPath: string) => void): void {
    // Only task notes under Projecten/ are synced; everything else is ignored.
    // The file is the note at its new path, so the filter reads the new path.
    const eventRef = this.app.vault.on('rename', (file, oldPath) => {
      if (
        file instanceof TFile &&
        file.extension === 'md' &&
        file.path.startsWith('Projecten/')
      ) {
        cb(oldPath, file.path);
      }
    });
    this.registerEvent(eventRef);
  }
}
