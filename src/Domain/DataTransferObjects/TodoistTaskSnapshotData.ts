import type { TodoistTaskData } from './TodoistTaskData.js';

// One pass's Todoist task snapshot: the project's active set plus the
// completed-since window, fetched once by SyncTodoistTasksAction and handed to
// every absorber and the projection. WHY: the same project's tasks used to be
// listed seven times per pass (each absorber fetched both sets, then the
// projection fetched active again); one snapshot makes a pass list the
// project's tasks once. The completed window is bounded by the cursor the half
// read at the top of the pass; no absorber advances it.
export interface TodoistTaskSnapshotData {
  active: TodoistTaskData[];
  completed: TodoistTaskData[];
}
