export class OriginObservation {
  readonly current: string | null;
  readonly currentCompleted: boolean;
  readonly fieldTime: string | null;
  readonly trustworthy: boolean;

  constructor(init: {
    current: string | null;
    currentCompleted: boolean;
    fieldTime: string | null;
    trustworthy: boolean;
  }) {
    this.current = init.current;
    this.currentCompleted = init.currentCompleted;
    this.fieldTime = init.fieldTime;
    this.trustworthy = init.trustworthy;
  }
}
