import type { ConnectionData } from '../shared/ConnectionData.js';

export interface ConnectionSyncInput {
  projectName: string;
  syncedAt: string;
  includeBoard: boolean;
  connections: Record<string, ConnectionData>;
}

export interface ConnectionSyncHalf {
  readonly connectionSlug: string;
  readonly requiresBoard: boolean;
  execute(input: ConnectionSyncInput): Promise<void>;
}

export interface SyncHalfFactory {
  create(slug: string, connection: ConnectionData): ConnectionSyncHalf | null;
}
