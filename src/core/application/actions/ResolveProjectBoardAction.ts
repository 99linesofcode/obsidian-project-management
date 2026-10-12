import { DomainError } from '../../domain/errors/DomainError.js';
import type { ProjectDiscovery } from '../../port/data/ProjectDiscovery.js';
import type { ProjectSummary } from '../../port/data/ProjectSummary.js';
import type { ProjectSetupSurface } from '../../port/MirrorPort.js';

export type ResolvedBoard =
  | { kind: 'create'; discovery: ProjectDiscovery; boardTitle: string }
  | { kind: 'adopt'; discovery: ProjectDiscovery; board: ProjectSummary };

export interface ResolveProjectBoardInput {
  target: string;
  setup: ProjectSetupSurface;
}

// The one home for the create/adopt/ambiguous decision: discover the target's
// boards, then pick the single one, the one titled with the target's name, or
// none — raising `several boards` when several are linked and none matches.
// Callers own what to do with the decision (attach defers creation; ensure
// creates or adopts an orphan).
export class ResolveProjectBoardAction {
  async execute(input: ResolveProjectBoardInput): Promise<ResolvedBoard> {
    const boardTitle = nameFromTarget(input.target);
    const discovery = await input.setup.discoverProjects(input.target);
    const choice = deriveBoardChoice(boardTitle, discovery.projects);
    if (choice.kind === 'ambiguous') {
      throw new DomainError(
        `ResolveProjectBoardAction: target ${input.target} has several boards and none is titled "${boardTitle}"`,
      );
    }
    return choice.kind === 'create'
      ? { kind: 'create', discovery, boardTitle }
      : { kind: 'adopt', discovery, board: choice.board };
  }
}

type BoardChoice =
  | { kind: 'create' }
  | { kind: 'adopt'; board: ProjectSummary }
  | { kind: 'ambiguous' };

function deriveBoardChoice(
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

function nameFromTarget(target: string): string {
  let segments: string[];
  try {
    segments = new URL(target).pathname
      .split('/')
      .filter((segment) => segment.length > 0);
  } catch {
    return '';
  }
  const name = segments[1] ?? '';
  return name.endsWith('.git') ? name.slice(0, -4) : name;
}
