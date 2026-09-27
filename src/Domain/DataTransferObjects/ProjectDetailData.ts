import type { BoardItemData } from './BoardItemData.js';
import type { GithubTaskData } from './GithubTaskData.js';

// A project's whole GitHub detail in one round trip: the tracked issues (with
// their bodies, so checklist → to-do extraction works from the same fetch) and
// the board's cards (with their lanes). The core's need is whole-project
// context per sync; the adapter resolves it with the fewest provider calls.
// Provider transport DTOs, mapped onto canonical TaskData at the boundary.
export interface ProjectDetailData {
  issues: GithubTaskData[];
  cards: BoardItemData[];
}
