import type { DeclaredConnection } from '../data/DeclaredConnection.js';

export interface ProjectSourcePort {
  readConnections(project: string): Promise<readonly DeclaredConnection[]>;
  listEntities(project: string): Promise<readonly string[]>;
}
