import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import { defaultStatusName } from '../projects/defaultStatusName.js';
import { typeFromLabels } from '../shared/typeFromLabels.js';

export interface PromoteIssueInput {
  url: string;
  label: string;
  projectName: string;
  connectionSlug: string;
}

export class PromoteIssueAction {
  constructor(
    private readonly port: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
  ) {}

  async execute(input: PromoteIssueInput): Promise<void> {
    await this.port.addLabel(input.url, input.label);

    const task = await this.port.fetchTask(input.url);
    const identity = await this.syncState.getIdentity(
      input.projectName,
      input.connectionSlug,
    );
    await this.createTaskNote.execute({
      url: task.url,
      title: task.title,
      body: task.body,
      type: typeFromLabels([input.label]),
      projectName: input.projectName,
      connectionSlug: input.connectionSlug,
      syncedAt: new Date().toISOString(),
      statusName: defaultStatusName(identity?.statusOptions ?? []),
    });
  }
}
