import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';

export interface PromoteCardInput {
  itemId: string;
  repoNodeId: string;
  projectName: string;
}

// UC11: promote a draft card on the project board into a real GitHub issue.
// Converts the card via the port, then materialises the task note immediately
// (via the note action) so the note appears now rather than on the next poll.
// Composed via constructor injection.
export class PromoteCardAction {
  constructor(
    private readonly port: ProjectManagementPort,
    private readonly createTaskNote: CreateTaskNoteAction,
  ) {}

  async execute(input: PromoteCardInput): Promise<void> {
    const task = await this.port.promoteCard(input.itemId, input.repoNodeId);

    await this.createTaskNote.execute({
      task,
      projectName: input.projectName,
      syncedAt: new Date().toISOString(),
    });
  }
}
