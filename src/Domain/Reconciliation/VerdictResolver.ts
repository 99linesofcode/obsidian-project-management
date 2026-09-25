import type { TaskData } from '../DataTransferObjects/TaskData.js';
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

  // The canonical three-way diff: compare the vault's, the remote's and the
  // snapshot's content fields. A field changed on both sides is a conflict and
  // the vault wins (dt-01). Identical for every provider, because the DTOs are
  // canonical. Pure: no I/O, no time, no randomness.
  diff(vault: TaskData, remote: TaskData, snapshot: TaskData): DimensionVerdict {
    const localChanged = contentOf(vault) !== contentOf(snapshot);
    const remoteChanged = contentOf(remote) !== contentOf(snapshot);
    if (localChanged && remoteChanged) return 'conflict';
    if (localChanged) return 'push';
    if (remoteChanged) return 'pull';
    return 'none';
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

// The comparable content of a canonical task: the fields the diff reads. The
// identity fields (url, ids, note path) link representations and never enter
// the comparison.
function contentOf(task: TaskData): string {
  return [
    task.title,
    task.body,
    task.status,
    task.completed ? '1' : '0',
    task.parent ?? '',
  ].join('\n');
}
