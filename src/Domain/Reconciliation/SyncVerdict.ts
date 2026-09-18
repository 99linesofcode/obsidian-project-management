// The per-dimension decision for one task: which way each dimension should
// move. 'conflict' always means Obsidian (the note) wins.
export type DimensionVerdict = 'push' | 'pull' | 'conflict' | 'none';

// The operations a sync should run, one verdict per dimension. The shape is
// extensible: later dimensions (e.g. status propagation) add fields without
// breaking consumers that read the existing body and status verdicts.
export class SyncVerdict {
  readonly body: DimensionVerdict;
  readonly status: DimensionVerdict;

  constructor(verdicts: { body: DimensionVerdict; status: DimensionVerdict }) {
    this.body = verdicts.body;
    this.status = verdicts.status;
  }
}
