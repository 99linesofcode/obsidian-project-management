import type { ConnectionDataTransferObject } from './ConnectionDataTransferObject.js';

export interface ProjectNoteDataTransferObject {
  path: string;
  projectName: string;
  archivedAt: string | null;
  connections: Record<string, ConnectionDataTransferObject>;
  connectionErrors: unknown[];
}
