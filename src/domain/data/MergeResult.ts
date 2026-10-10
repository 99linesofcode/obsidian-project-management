import type { Delta } from './Delta.js';

export type MergeOutcome = 'unchanged' | 'value' | 'delete';

export type MergeRung = 0 | 1 | 2 | 3;

export class MergeResult {
  readonly outcome: MergeOutcome;
  readonly value: string | null;
  readonly winner: string | null;
  readonly rung: MergeRung;
  readonly deltas: readonly Delta[];
  readonly superseded: readonly Delta[];

  constructor(init: {
    outcome: MergeOutcome;
    value: string | null;
    winner: string | null;
    rung: MergeRung;
    deltas: readonly Delta[];
    superseded: readonly Delta[];
  }) {
    this.outcome = init.outcome;
    this.value = init.value;
    this.winner = init.winner;
    this.rung = init.rung;
    this.deltas = init.deltas;
    this.superseded = init.superseded;
  }
}
