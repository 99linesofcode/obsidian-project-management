import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import { defaultStatusName } from '../Board/defaultStatusName.js';

export interface PromoteCardInput {
  itemId: string;
  repoNodeId: string;
  projectName: string;
}

// UC: promote a board card into a tracked task with a note. The note starts
// in the project's default lane.
export class PromoteCardAction {
  constructor(
    private readonly port: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
  ) {}

  async execute(input: PromoteCardInput): Promise<void> {
    const task = await this.port.promoteCard(input.itemId, input.repoNodeId);

    const identity = await this.syncState.getIdentity(input.projectName);
    await this.createTaskNote.execute({
      task,
      projectName: input.projectName,
      syncedAt: new Date().toISOString(),
      statusName: defaultStatusName(identity?.statusOptions ?? []),
    });
  }
}
