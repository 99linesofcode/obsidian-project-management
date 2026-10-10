import type { ProjectSummary } from '../application/data/ProjectSummary.js';

export type BoardChoice =
  | { kind: 'create' }
  | { kind: 'adopt'; board: ProjectSummary }
  | { kind: 'ambiguous' };

export function deriveBoardChoice(
  targetName: string,
  boards: readonly ProjectSummary[],
): BoardChoice {
  if (boards.length === 0) {
    return { kind: 'create' };
  }
  if (boards.length === 1) {
    return { kind: 'adopt', board: boards[0]! };
  }
  const match = boards.find((board) => board.name === targetName);
  return match === undefined
    ? { kind: 'ambiguous' }
    : { kind: 'adopt', board: match };
}
