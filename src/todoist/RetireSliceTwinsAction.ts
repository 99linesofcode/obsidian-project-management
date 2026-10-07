import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskManagerPort } from '../shared/TaskManagerPort.js';
import type { TodoistTaskData } from './TodoistTaskData.js';

export interface RetireSliceTwinsInput {
  projectName: string;
  // The connection whose mirror this pass advances.
  connectionSlug: string;
  // The twin ids of the project's slice items, resolved by the caller.
  sliceHandles: string[];
  // The pass's active Todoist set, so a slice's children can be flattened.
  active: TodoistTaskData[];
}

// Retires every existing slice twin (dt-23): a slice is a project-management
// artifact and never materializes in Todoist. Ordering is the whole point:
// Todoist cascades a parent deletion to its subtasks, so every direct child is
// moved to the top level FIRST, awaited, and only then is the slice twin
// deleted. A failed flatten aborts before the delete — the twin retires next
// tick rather than taking its children with it.
export class RetireSliceTwinsAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: RetireSliceTwinsInput): Promise<void> {
    for (const twin of input.sliceHandles) {
      for (const child of input.active.filter(
        (task) => task.parentId === twin,
      )) {
        await this.taskManager.moveTask(child.id, { parentId: null });
      }
      await this.taskManager.deleteTask(twin);
      // Drop the stale mirror item so no later pass resolves the retired
      // handle and the capture path can never re-anchor the deleted twin.
      await this.syncState.removeMirrorItem(
        input.projectName,
        input.connectionSlug,
        twin,
      );
    }
  }
}
