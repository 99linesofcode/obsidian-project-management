import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import { defaultStatusName } from '../projects/defaultStatusName.js';
import { typeFromLabels } from '../shared/typeFromLabels.js';

export interface PromoteIssueInput {
  url: string;
  label: string;
  projectName: string;
}

// UC10: promote a code-host issue into a tracked task. Applies the type label
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
      url: task.url,
      title: task.title,
      body: task.body,
      // The promoted label IS the vault-owned type (e.g. `type: task`).
      type: typeFromLabels([input.label]),
      projectName: input.projectName,
      syncedAt: new Date().toISOString(),
      statusName: defaultStatusName(identity?.statusOptions ?? []),
    });
  }
}
