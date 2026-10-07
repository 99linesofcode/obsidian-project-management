import { boardOptionIDByName } from './boardOptionIDByName.js';
import { BoardStatusData } from '../shared/BoardStatusData.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';

export interface BoardStatusInput {
  projectName: string;
  connectionSlug: string;
  url: string;
  statusName: string;
}

export class BoardStatusAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
  ) {}

  async execute(input: BoardStatusInput): Promise<void> {
    const identity = await this.syncState.getIdentity(
      input.projectName,
      input.connectionSlug,
    );
    if (!identity) {
      return;
    }

    const optionId = boardOptionIDByName(
      identity.statusOptions,
      input.statusName,
    );

    const item = await this.syncState.findMirrorItem(
      input.connectionSlug,
      input.url,
    );
    const currentStatus = item?.base?.status ?? '';
    const current = identity.statusOptions.find(
      (option) => option.name === currentStatus,
    );
    if (current?.id === optionId) {
      return;
    }

    await this.projectManagement.setBoardStatus(
      new BoardStatusData({
        projectNodeId: identity.projectNodeId,
        statusFieldId: identity.statusFieldId,
        issueUrl: input.url,
        statusOptionId: optionId,
      }),
    );
  }
}
