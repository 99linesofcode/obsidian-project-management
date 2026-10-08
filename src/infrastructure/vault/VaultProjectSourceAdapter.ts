import { ConnectionEnvelope } from '../../core/data/ConnectionEnvelope.js';
import { DeclaredConnection } from '../../core/data/DeclaredConnection.js';
import type { ProjectSourcePort } from '../../core/ports/ProjectSourcePort.js';
import { connectionsOf } from '../../vault/connectionsOf.js';

export interface NoteSource {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
  listNotesInFolder(folder: string): Promise<string[]>;
}

export class VaultProjectSourceAdapter implements ProjectSourcePort {
  constructor(private readonly notes: NoteSource) {}

  async readConnections(
    project: string,
  ): Promise<readonly DeclaredConnection[]> {
    const note = await this.notes.getNoteByPath(homePath(project));
    if (note === null) {
      return [];
    }
    return Object.entries(connectionsOf(note.content)).map(
      ([slug, connection]) =>
        new DeclaredConnection({
          slug,
          envelope: new ConnectionEnvelope({
            application: connection.tool,
            target: connection.project,
          }),
        }),
    );
  }

  async listEntities(project: string): Promise<readonly string[]> {
    return this.notes.listNotesInFolder(`Projecten/${project}/taken`);
  }
}

function homePath(project: string): string {
  return `Projecten/${project}/_${project}.md`;
}
