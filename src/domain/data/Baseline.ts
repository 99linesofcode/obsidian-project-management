export class Baseline {
  readonly value: string | null;
  readonly completed: boolean;

  constructor(value: string | null, completed: boolean) {
    this.value = value;
    this.completed = completed;
  }
}
