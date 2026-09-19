import { hash } from '../Notes/hash.js';
import type { ObservedState } from './ObservedState.js';
import { SyncVerdict } from './SyncVerdict.js';
import type { DimensionVerdict } from './SyncVerdict.js';

// Decides, per dimension, whether the note or the remote changed since the
// last sync and which way the change should move. Pure: no I/O, no time, no
// randomness — the same input always yields the same verdict.
export class VerdictResolver {
  resolve(observed: ObservedState): SyncVerdict {
    const body = this.resolveDimension(
      hash(observed.note.body) !== observed.baseline.lastSyncedBodyHash,
      observed.remote.updatedAt !== observed.baseline.lastSyncedRemoteUpdatedAt,
    );

    const status = this.resolveDimension(
      observed.note.status !== observed.baseline.lastSyncedStatus,
      observed.remote.status !== observed.baseline.lastSyncedStatus,
    );

    return new SyncVerdict({ body, status });
  }

  private resolveDimension(
    localChanged: boolean,
    remoteChanged: boolean,
  ): DimensionVerdict {
    if (localChanged && remoteChanged) return 'conflict';
    if (localChanged) return 'push';
    if (remoteChanged) return 'pull';
    return 'none';
  }
}
