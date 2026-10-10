import type { RepoBoardData } from '../shared/RepoBoardData.js';

export type BoardChoice =
  | { kind: 'create' }
  | { kind: 'adopt'; board: RepoBoardData }
  | { kind: 'ambiguous' };

export function deriveBoardChoice(
  repoName: string,
  boards: RepoBoardData[],
): BoardChoice {
  if (boards.length === 0) {
    return { kind: 'create' };
  }
  if (boards.length === 1) {
    return { kind: 'adopt', board: boards[0]! };
  }
  const match = boards.find((board) => board.name === repoName);
  return match === undefined
    ? { kind: 'ambiguous' }
    : { kind: 'adopt', board: match };
}
