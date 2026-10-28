import type { ConnectionDataTransferObject } from './ConnectionDataTransferObject.js';

export interface ProjectNoteDataTransferObject {
  id: string;
  path: string;
  projectName: string;
  connections: readonly ConnectionDataTransferObject[];
  connectionErrors: unknown[];
}
