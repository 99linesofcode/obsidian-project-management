import { App, EventRef, TFile } from 'obsidian';
import type { ProjectNoteData } from '../../core/application/data/ProjectNoteData.js';
import type { NoteEnumeratorPort } from '../../core/port/NoteEnumeratorPort.js';
import type { NoteReaderPort } from '../../core/port/NoteReaderPort.js';
import type { NoteWriterPort } from '../../core/port/NoteWriterPort.js';
import type { VaultEventPort } from '../../core/port/VaultEventPort.js';
import { chooseHomeNotePath } from '../../core/domain/projectHomePath.js';
import { ConnectionValidator } from '../../core/domain/ConnectionValidator.js';
import { folderChainForPath } from '../../core/domain/folderChainForPath.js';
import { projectNoteFromCache } from '../../core/domain/projectNoteFromCache.js';

export type EventRegistrar = (eventRef: EventRef) => void;

export class VaultAdapter
  implements NoteReaderPort, NoteWriterPort, NoteEnumeratorPort, VaultEventPort
{
  private readonly connectionValidator: ConnectionValidator;

  constructor(
    private readonly app: App,
    private readonly registerEvent: EventRegistrar,
    registeredApplications: ReadonlySet<string>,
  ) {
    this.connectionValidator = new ConnectionValidator(registeredApplications);
  }

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }

    const content = await this.app.vault.read(file);
    return { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    await this.ensureFolders(path);
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
      await this.ensureFolders(newPath);
      await this.app.fileManager.renameFile(file, newPath);
    }
  }

  async moveFolder(fromPrefix: string, toPrefix: string): Promise<void> {
    const from = fromPrefix.endsWith('/') ? fromPrefix : `${fromPrefix}/`;
    const to = toPrefix.endsWith('/') ? toPrefix : `${toPrefix}/`;
    const files = this.app.vault
      .getFiles()
      .filter((file) => file.path.startsWith(from));
    for (const file of files) {
      await this.renameNote(file.path, `${to}${file.path.slice(from.length)}`);
    }
  }

  private async ensureFolders(path: string): Promise<void> {
    for (const folder of folderChainForPath(path)) {
      if (!this.app.vault.getFolderByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
    }
  }

  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => file.path);
  }

  async modifiedTime(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }
    return new Date(file.stat.mtime).toISOString();
  }

  async trashNote(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.fileManager.trashFile(file);
    }
  }

  async findProjectNotes(): Promise<ProjectNoteData[]> {
    const notes: ProjectNoteData[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const note = projectNoteFromCache(
        file.path,
        cache?.frontmatter,
        this.connectionValidator,
      );
      if (note) {
        notes.push(note);
      }
    }
    return notes;
  }

  async findHomeNotePath(project: string): Promise<string | null> {
    const notes = (await this.findProjectNotes()).filter(
      (note) => note.projectName === project,
    );
    return chooseHomeNotePath(
      notes.map((note) => note.path),
      project,
    );
  }

  onNoteChanged(cb: (path: string) => void): void {
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
