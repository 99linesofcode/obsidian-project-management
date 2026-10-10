export type DeltaKind = 'value' | 'delete';

export class Delta {
  readonly side: string;
  readonly kind: DeltaKind;
  readonly value: string | null;
  readonly time: string | null;
  readonly trustworthy: boolean;
  readonly completed: boolean;

  constructor(init: {
    side: string;
    kind: DeltaKind;
    value: string | null;
    time: string | null;
    trustworthy: boolean;
    completed: boolean;
  }) {
    this.side = init.side;
    this.kind = init.kind;
    this.value = init.value;
    this.time = init.time;
    this.trustworthy = init.trustworthy;
    this.completed = init.completed;
  }
}
