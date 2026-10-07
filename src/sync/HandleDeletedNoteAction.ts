import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskData } from '../shared/TaskData.js';

export interface HandleDeletedNoteInput {
  notePath: string;
  projectName: string;
  connectionSlug: string | null;
}

export class HandleDeletedNoteAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: HandleDeletedNoteInput): Promise<void> {
    const record = await this.syncState.findByNotePath(input.notePath);
    if (!record) {
      return;
    }

    const github =
      input.connectionSlug === null
        ? null
        : await this.githubItem(input.connectionSlug, record.id);
    const url = github?.handle ?? '';

    const identity =
      input.connectionSlug === null
        ? null
        : await this.syncState.getIdentity(
            input.projectName,
            input.connectionSlug,
          );
    if (identity && url !== '') {
      await this.projectManagement.deleteCard(identity.projectNodeId, url);
    }

    const lane = github?.base?.status ?? '';
    if (url !== '' && lane !== this.doneOptionName) {
      await this.projectManagement.setTaskState(url, 'closed');
    }
    await this.syncState.removeEntity(record.id);
  }

  private async githubItem(
    connectionSlug: string,
    entityId: string,
  ): Promise<{ handle: string; base: TaskData | null } | null> {
    const found = await this.syncState.findMirrorItemByEntity(
      connectionSlug,
      entityId,
    );
    return found === null
      ? null
      : { handle: found.handle, base: found.item.base };
  }
}
