import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { SyncVerdict } from './SyncVerdict.js';
import type { DimensionVerdict } from './SyncVerdict.js';

export type ConflictField =
  'title' | 'body' | 'status' | 'completedAt' | 'type' | 'parent';

// The timing evidence the conflict ladder may use. Timestamps are passed in,
// not read, so the resolver stays pure.
export type ConflictHints = {
  vaultModifiedAt: string | null;
  remoteFieldTimes: Partial<Record<ConflictField, string | null>>;
};

// Decides, per content field, whether the vault or the remote changed since the
// last sync and which way the change should move. Attribution is content-vs-
// base, not timestamp-vs-timestamp: clocks skew across machines and providers,
// and a provider's updatedAt moves for reasons that are not content (GitHub
// bumps it on comments), so a timestamp alone cannot say who changed what. Only
// a remote field time that provably postdates every local edit is trusted.
// Otherwise a field changed on both sides resolves by origin authority — the
// vault is the origin of truth — so no conflict is left unresolved. Pure: no
// I/O, no time, no randomness.
export class VerdictResolver {
  private readonly doneLane: string;

  constructor(doneLane: string) {
    this.doneLane = doneLane;
  }

  // The three-way diff over canonical diff views (body = digest). Each field is
  // attributed independently, so a vault body edit and a remote status change
  // are not forced into one verdict.
  diff(vault: TaskData, remote: TaskData, base: TaskData): SyncVerdict {
    return new SyncVerdict({
      title: attribute(vault.title, remote.title, base.title),
      body: attribute(vault.body, remote.body, base.body),
      status: attribute(vault.status, remote.status, base.status),
      completedAt: attribute(
        vault.completedAt,
        remote.completedAt,
        base.completedAt,
      ),
      type: attribute(vault.type, remote.type, base.type),
      parent: attribute(vault.parent, remote.parent, base.parent),
    });
  }

  // The conflict ladder, applied field by field to a diff's verdicts. Decisive
  // timestamps come first; then the status semantic rule; then origin
  // authority.
  resolveConflicts(
    vault: TaskData,
    remote: TaskData,
    verdicts: SyncVerdict,
    hints: ConflictHints,
  ): SyncVerdict {
    return new SyncVerdict({
      title: this.resolveConflict(
        'title',
        verdicts.title,
        vault,
        remote,
        hints,
      ),
      body: this.resolveConflict('body', verdicts.body, vault, remote, hints),
      status: this.resolveConflict(
        'status',
        verdicts.status,
        vault,
        remote,
        hints,
      ),
      completedAt: this.resolveConflict(
        'completedAt',
        verdicts.completedAt,
        vault,
        remote,
        hints,
      ),
      type: this.resolveConflict('type', verdicts.type, vault, remote, hints),
      parent: this.resolveConflict(
        'parent',
        verdicts.parent,
        vault,
        remote,
        hints,
      ),
    });
  }

  private resolveConflict(
    field: ConflictField,
    verdict: DimensionVerdict,
    vault: TaskData,
    remote: TaskData,
    hints: ConflictHints,
  ): DimensionVerdict {
    if (verdict !== 'conflict') return verdict;

    if (remotePostdatesVault(field, hints)) return 'pull';

    if (field === 'status') return this.doneBeatsOpen(vault, remote);

    return 'push';
  }

  // A completion from either side beats staleness; a reopen is vetoed while the
  // other side still shows done. When both sides agree on the done-state the
  // semantic rule cannot decide, so origin authority applies: the vault's value
  // wins and the mirror catches up. WHY not 'none': a two-sided conflict left
  // undecided runs no writer and leaves vault and mirror permanently diverged,
  // contradicting SYNC-3 ("no field is ever left undecided"). Both-done
  // conflicts differ only in lane cosmetics, so the vault's lane is the right
  // resolution.
  private doneBeatsOpen(vault: TaskData, remote: TaskData): DimensionVerdict {
    const vaultDone = isDone(vault, this.doneLane);
    const remoteDone = isDone(remote, this.doneLane);
    // Both agree: the semantic rule cannot decide, so origin authority pushes
    // the vault's lane. Disagree: the completion wins.
    if (vaultDone === remoteDone) return 'push';
    return vaultDone ? 'push' : 'pull';
  }
}

// Content-vs-base attribution: a field is changed on a side when it differs
// from the base the last sync stored.
function attribute(
  local: string | null,
  remote: string | null,
  base: string | null,
): DimensionVerdict {
  const localChanged = local !== base;
  const remoteChanged = remote !== base;
  if (localChanged && remoteChanged) return 'conflict';
  if (localChanged) return 'push';
  if (remoteChanged) return 'pull';
  return 'none';
}

// Decisive-when-safe: only a remote time that provably postdates the vault's
// last modification wins; every other comparison is left to the semantic rules.
function remotePostdatesVault(
  field: ConflictField,
  hints: ConflictHints,
): boolean {
  const remoteTime = hints.remoteFieldTimes[field] ?? null;
  if (remoteTime === null || hints.vaultModifiedAt === null) return false;
  return Date.parse(remoteTime) > Date.parse(hints.vaultModifiedAt);
}

// A side is done when it carries a completion stamp or its lane is the
// project's done lane; a project with no board ('') has no done lane.
function isDone(task: TaskData, doneLane: string): boolean {
  return (
    task.completedAt !== null || (doneLane !== '' && task.status === doneLane)
  );
}
