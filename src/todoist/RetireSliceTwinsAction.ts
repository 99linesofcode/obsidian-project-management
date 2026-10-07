import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskManagerPort } from '../shared/TaskManagerPort.js';
import type { TodoistTaskData } from './TodoistTaskData.js';

export interface RetireSliceTwinsInput {
  projectName: string;
  connectionSlug: string;
  sliceHandles: string[];
  active: TodoistTaskData[];
}

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
      await this.syncState.removeMirrorItem(
        input.projectName,
        input.connectionSlug,
        twin,
      );
    }
  }
}
