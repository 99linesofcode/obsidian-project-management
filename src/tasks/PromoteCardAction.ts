import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import { defaultStatusName } from '../projects/defaultStatusName.js';
import { typeFromLabels } from '../shared/typeFromLabels.js';

export interface PromoteCardInput {
  itemId: string;
  repoNodeId: string;
  projectName: string;
  connectionSlug: string;
}

export class PromoteCardAction {
  constructor(
    private readonly port: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
  ) {}

  async execute(input: PromoteCardInput): Promise<void> {
    const task = await this.port.promoteCard(input.itemId, input.repoNodeId);

    const identity = await this.syncState.getIdentity(
      input.projectName,
      input.connectionSlug,
    );
    await this.createTaskNote.execute({
      url: task.url,
      title: task.title,
      body: task.body,
      type: typeFromLabels(task.labels),
      projectName: input.projectName,
      connectionSlug: input.connectionSlug,
      syncedAt: new Date().toISOString(),
      statusName: defaultStatusName(identity?.statusOptions ?? []),
    });
  }
}
