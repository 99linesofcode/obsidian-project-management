import type { ConnectionData } from './ConnectionData.js';

export interface ProjectNoteData {
  path: string;
  projectName: string;
  archivedAt: string | null;
  connections: Record<string, ConnectionData>;
  connectionErrors: unknown[];
}
