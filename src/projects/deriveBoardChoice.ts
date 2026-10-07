import type { RepoBoardData } from '../shared/RepoBoardData.js';

// The derivation ladder's decision, pure and side-effect free: no boards ->
// create one; exactly one -> adopt it; several -> adopt the one titled with the
// repo name, else ambiguous. The caller surfaces the ambiguous case as a
// discovery error and creates or adopts nothing, so a repo with several
// unrelated boards is never silently guessed at.
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
