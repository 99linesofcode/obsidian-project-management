import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import { defaultStatusName } from '../Board/defaultStatusName.js';

export interface PromoteIssueInput {
  url: string;
  label: string;
  projectName: string;
}

// UC10: promote a GitHub issue into a tracked task. Applies the type label
// first, then materialises the task note immediately (via the note action) so
// the note appears now rather than on the next poll. Composed via constructor
// injection; the label is applied idempotently even if the issue is already
// labelled.
export class PromoteIssueAction {
  constructor(
    private readonly port: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
  ) {}

  async execute(input: PromoteIssueInput): Promise<void> {
    await this.port.addLabel(input.url, input.label);

    const task = await this.port.fetchTask(input.url);
    const identity = await this.syncState.getIdentity(input.projectName);
    await this.createTaskNote.execute({
      task,
      projectName: input.projectName,
      syncedAt: new Date().toISOString(),
      statusName: defaultStatusName(identity?.statusOptions ?? []),
    });
  }
}
