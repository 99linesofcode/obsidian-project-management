// The per-field decision for one entity: which way each content field should
// move. 'conflict' means both sides changed since base and the ladder must
// arbitrate; the other three are already decided.
export type DimensionVerdict = 'push' | 'pull' | 'conflict' | 'none';

// One verdict per diffed content field, mirroring TaskData.canonical()
// field-for-field so the resolver and its consumers agree on the vocabulary.
export class SyncVerdict {
  readonly title: DimensionVerdict;
  readonly body: DimensionVerdict;
  readonly status: DimensionVerdict;
  readonly completedAt: DimensionVerdict;
  readonly type: DimensionVerdict;
  readonly parent: DimensionVerdict;

  constructor(verdicts: {
    title: DimensionVerdict;
    body: DimensionVerdict;
    status: DimensionVerdict;
    completedAt: DimensionVerdict;
    type: DimensionVerdict;
    parent: DimensionVerdict;
  }) {
    this.title = verdicts.title;
    this.body = verdicts.body;
    this.status = verdicts.status;
    this.completedAt = verdicts.completedAt;
    this.type = verdicts.type;
    this.parent = verdicts.parent;
  }
}
