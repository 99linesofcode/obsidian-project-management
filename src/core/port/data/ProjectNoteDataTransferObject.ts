import type { ConnectionDataTransferObject } from './ConnectionDataTransferObject.js';

export interface ProjectNoteDataTransferObject {
  path: string;
  projectName: string;
  connections: readonly ConnectionDataTransferObject[];
  connectionErrors: unknown[];
}
