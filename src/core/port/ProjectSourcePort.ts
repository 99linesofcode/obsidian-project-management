import type { ConnectionDataTransferObject } from '../application/data/ConnectionDataTransferObject.js';

export interface ProjectSourcePort {
  readConnections(
    project: string,
  ): Promise<readonly ConnectionDataTransferObject[]>;
  listEntities(project: string): Promise<readonly string[]>;
}
