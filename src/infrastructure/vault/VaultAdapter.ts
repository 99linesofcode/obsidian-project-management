import { App, EventRef, TFile } from 'obsidian';
import type { ProjectNoteDataTransferObject } from '../../core/port/data/ProjectNoteDataTransferObject.js';
import type { CanonicalField } from '../../core/domain/canonicalField.js';
import type { CanonicalFieldWrite } from '../../core/port/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../core/port/data/CanonicalTask.js';
import { AdoptedProject } from '../../core/port/data/AdoptedProject.js';
import type { CapturedProject } from '../../core/port/data/CapturedProject.js';
import { ConnectionDataTransferObject } from '../../core/port/data/ConnectionDataTransferObject.js';
import { OriginObservation } from '../../core/domain/OriginObservation.js';
import type { VaultPort } from '../../core/port/VaultPort.js';
import {
  chooseHomeNotePath,
  folderChainForPath,
  projectHomePath,
} from '../../core/domain/paths.js';
import { ConnectionValidationService } from '../../core/application/services/ConnectionValidationService.js';
import { projectNoteFromCache } from '../../core/application/data/projectNoteFromCache.js';
import { slugify, typeFromLabels } from '../../core/domain/note.js';
import { connectionsOf } from './connectionsOf.js';
import { renderConnectionsBlock } from './renderConnectionsBlock.js';
import { fieldValue, folderOf, parseTaskNote, writeIntoNote } from './taskNoteCodec.js';

export type EventRegistrar = (eventRef: EventRef) => void;

export class VaultAdapter implements VaultPort {
  private readonly connectionValidator: ConnectionValidationService;

  constructor(
    private readonly app: App,
    private readonly registerEvent: EventRegistrar,
    registeredApplications: ReadonlySet<string>,
  ) {
    this.connectionValidator = new ConnectionValidationService(
      registeredApplications,
    );
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

  async trashNote(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.fileManager.trashFile(file);
    }
  }

  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => file.path);
  }

  async findProjectNotes(): Promise<ProjectNoteDataTransferObject[]> {
    const notes: ProjectNoteDataTransferObject[] = [];
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

  async observe(
    handle: string,
    field: CanonicalField,
  ): Promise<OriginObservation> {
    const file = this.app.vault.getAbstractFileByPath(handle);
    if (!(file instanceof TFile)) {
      return new OriginObservation({
        current: null,
        currentCompleted: false,
        fieldTime: null,
        trustworthy: true,
      });
    }

    const note = parseTaskNote(await this.app.vault.read(file), handle);
    if (typeFromLabels(note.labels) === '') {
      return new OriginObservation({
        current: null,
        currentCompleted: false,
        fieldTime: null,
        trustworthy: true,
      });
    }
    return new OriginObservation({
      current: fieldValue(note, field),
      currentCompleted: note.completed,
      fieldTime: new Date(file.stat.mtime).toISOString(),
      trustworthy: true,
    });
  }

  async readTask(handle: string): Promise<CanonicalTask | null> {
    const file = this.app.vault.getAbstractFileByPath(handle);
    if (!(file instanceof TFile)) {
      return null;
    }

    const note = parseTaskNote(await this.app.vault.read(file), handle);
    if (typeFromLabels(note.labels) === '') {
      return null;
    }
    return new CanonicalTask({
      handle,
      entityId: handle,
      title: note.title,
      body: note.body,
      status: note.status,
      completed: note.completed,
      parent: note.parent,
      labels: note.labels,
    });
  }

  async applyField(write: CanonicalFieldWrite): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(write.handle);
    if (!(file instanceof TFile)) {
      throw new Error(`origin note not found: ${write.handle}`);
    }

    if (write.field === 'title') {
      await this.rename(file, write.value);
      return;
    }

    const content = await this.app.vault.read(file);
    const updated = writeIntoNote(content, write);
    if (updated === content) {
      throw new Error(
        `origin note cannot accept ${write.field}: ${write.handle}`,
      );
    }
    await this.app.vault.modify(file, updated);
  }

  async readConnections(
    project: string,
  ): Promise<readonly ConnectionDataTransferObject[]> {
    const path = await this.findHomeNotePath(project);
    if (path === null) {
      return [];
    }
    const note = await this.getNoteByPath(path);
    if (note === null) {
      return [];
    }
    return Object.entries(connectionsOf(note.content)).map(
      ([slug, connection]) =>
        new ConnectionDataTransferObject({
          slug,
          application: connection.tool,
          target: connection.project,
        }),
    );
  }

  async listEntities(project: string): Promise<readonly string[]> {
    return this.listNotesInFolder(`Projecten/${project}/taken`);
  }

  async observeProject(project: string): Promise<OriginObservation> {
    const path = await this.findHomeNotePath(project);
    if (path === null) {
      return new OriginObservation({
        current: null,
        currentCompleted: false,
        fieldTime: null,
        trustworthy: true,
      });
    }

    return new OriginObservation({
      current: path.startsWith('Archief/') ? 'true' : 'false',
      currentCompleted: false,
      fieldTime: await this.modifiedTime(path),
      trustworthy: true,
    });
  }

  async applyProjectArchived(
    project: string,
    archived: boolean,
  ): Promise<void> {
    const from = archived ? 'Projecten' : 'Archief';
    const to = archived ? 'Archief' : 'Projecten';
    await this.moveFolder(`${from}/${project}`, `${to}/${project}`);
  }

  async listAdoptedProjects(): Promise<readonly AdoptedProject[]> {
    const adopted: AdoptedProject[] = [];
    for (const note of await this.findProjectNotes()) {
      for (const connection of note.connections) {
        adopted.push(
          new AdoptedProject({
            projectName: note.projectName,
            application: connection.application,
            target: connection.target,
          }),
        );
      }
    }
    return adopted;
  }

  async adoptProject(
    project: CapturedProject,
    application: string,
    slug: string,
  ): Promise<void> {
    const target = project.targets[0];
    if (target === undefined) {
      throw new Error(`project "${project.name}" has no target to adopt`);
    }

    const path = projectHomePath(project.name, false);
    if ((await this.getNoteByPath(path)) !== null) {
      return;
    }

    await this.createNote(
      path,
      homeNote(project.name, slug, application, target),
    );
  }

  private async modifiedTime(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }
    return new Date(file.stat.mtime).toISOString();
  }

  private async findHomeNotePath(project: string): Promise<string | null> {
    const notes = (await this.findProjectNotes()).filter(
      (note) => note.projectName === project,
    );
    return chooseHomeNotePath(
      notes.map((note) => note.path),
      project,
    );
  }

  private async moveFolder(fromPrefix: string, toPrefix: string): Promise<void> {
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

  private async rename(file: TFile, title: string | null): Promise<void> {
    if (title === null) {
      return;
    }
    const slug = slugify(title);
    if (slug === '') {
      throw new Error(`origin note has no usable title: ${file.path}`);
    }
    const folder = folderOf(file.path);
    await this.app.fileManager.renameFile(
      file,
      folder === null ? `${slug}.md` : `${folder}/${slug}.md`,
    );
  }
}

function homeNote(
  name: string,
  slug: string,
  application: string,
  target: string,
): string {
  return [
    '---',
    ...renderConnectionsBlock({
      [slug]: { tool: application, project: target },
    }),
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n');
}
