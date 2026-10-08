import type { ConnectionEnvelope } from '../data/ConnectionEnvelope.js';

export interface ProjectSourcePort {
  readConnections(project: string): Promise<readonly ConnectionEnvelope[]>;
  listEntities(project: string): Promise<readonly string[]>;
}
