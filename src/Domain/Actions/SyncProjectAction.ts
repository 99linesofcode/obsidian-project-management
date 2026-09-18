import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { ApplyRemoteChangeAction } from './ApplyRemoteChangeAction.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';

export interface SyncProjectInput {
  projectName: string;
  syncedAt: string;
}

// The cursor used when a project has never been polled: the Unix epoch, so
// the first poll fetches every issue and materialises the whole project.
const EPOCH = '1970-01-01T00:00:00.000Z';

// UC3: sync one project. Fetches the tasks changed since the last poll and
// mirrors each onto its note — applying changes to existing notes, creating
// notes for newly promoted issues — then advances the poll cursor.
export class SyncProjectAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly applyRemoteChange: ApplyRemoteChangeAction,
    private readonly createTaskNote: CreateTaskNoteAction,
  ) {}

  async execute(input: SyncProjectInput): Promise<void> {
    const since = (await this.syncState.getLastPoll(input.projectName)) ?? EPOCH;
    const tasks = await this.projectManagement.fetchChangedTasks(since);

    for (const task of tasks) {
      const status = await this.syncState.get(task.url);
      if (status) {
        await this.applyRemoteChange.execute({
          task,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      } else {
        await this.createTaskNote.execute({
          task,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      }
    }

    await this.syncState.setLastPoll(input.projectName, input.syncedAt);
  }
}
