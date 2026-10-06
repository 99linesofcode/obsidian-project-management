import type { BoardItemData } from './BoardItemData.js';
import type { CodeHostTaskData } from './CodeHostTaskData.js';

// A project's whole code-host detail in one round trip: the tracked issues
// (with their bodies, so checklist → to-do extraction works from the same
// fetch) and the board's cards (with their lanes). The core's need is
// whole-project context per sync; the adapter resolves it with the fewest
// provider calls. Transport DTOs, mapped onto canonical TaskData at the
// boundary.
//
// WHY this lives in the shared kernel and not src/github: the port that returns
// it is the core's need, owned by no provider. `issues` is the neutral
// CodeHostTaskData, not the provider alias, so the shared kernel imports from
// no provider module.
export interface ProjectDetailData {
  issues: CodeHostTaskData[];
  cards: BoardItemData[];
}
