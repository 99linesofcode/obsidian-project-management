import type { DeclaredConnection } from '../application/data/DeclaredConnection.js';

export interface ProjectSourcePort {
  readConnections(project: string): Promise<readonly DeclaredConnection[]>;
  listEntities(project: string): Promise<readonly string[]>;
}
