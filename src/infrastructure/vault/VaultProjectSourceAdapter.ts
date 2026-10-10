import { ConnectionDataTransferObject } from '../../core/application/data/ConnectionDataTransferObject.js';
import type { ProjectSourcePort } from '../../core/port/ProjectSourcePort.js';
import { connectionsOf } from './connectionsOf.js';

export interface NoteSource {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
  listNotesInFolder(folder: string): Promise<string[]>;
  findHomeNotePath(project: string): Promise<string | null>;
}

export class VaultProjectSourceAdapter implements ProjectSourcePort {
  constructor(private readonly notes: NoteSource) {}

  async readConnections(
    project: string,
  ): Promise<readonly ConnectionDataTransferObject[]> {
    const path = await this.notes.findHomeNotePath(project);
    if (path === null) {
      return [];
    }
    const note = await this.notes.getNoteByPath(path);
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
    return this.notes.listNotesInFolder(`Projecten/${project}/taken`);
  }
}
