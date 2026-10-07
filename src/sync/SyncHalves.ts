import type { ConnectionData } from '../shared/ConnectionData.js';

// The input every per-connection sync half receives. The chain owns the
// project-level gates (the code-host probe and the freeze verdict) and passes
// their outcome; the half owns its connection's wire.
export interface ConnectionSyncInput {
  projectName: string;
  syncedAt: string;
  // The code-host probe's verdict: the remote moved since the last poll. A
  // task-manager half ignores it.
  includeBoard: boolean;
  // The project's full connection map, so a half can resolve a sibling
  // connection's slug for cross-connection propagation.
  connections: Record<string, ConnectionData>;
}

// One sync half, bound to one connection. The chain composes one per connection
// declared in the note, so a project with two task-manager connections runs the
// task-manager half twice — each with its own adapter and its own port state.
export interface ConnectionSyncHalf {
  readonly connectionSlug: string;
  // Whether this half needs the code-host probe (the board gate). The chain
  // skips a board half when the probe produced no state.
  readonly requiresBoard: boolean;
  execute(input: ConnectionSyncInput): Promise<void>;
}

// Builds the half for a connection. The composition root supplies the
// implementation; the chain never imports an adapter.
export interface SyncHalfFactory {
  create(slug: string, connection: ConnectionData): ConnectionSyncHalf | null;
}
