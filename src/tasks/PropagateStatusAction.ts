import { stateFromStatus } from './stateFromStatus.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { BoardStatusAction } from '../projects/BoardStatusAction.js';

export interface PropagateStatusInput {
  url: string;
  statusName: string;
  notePath: string;
  projectName: string;
  connectionSlug: string;
}

export class PropagateStatusAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly boardStatus: BoardStatusAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: PropagateStatusInput): Promise<void> {
    const item = await this.syncState.findMirrorItem(
      input.connectionSlug,
      input.url,
    );
    const next = stateFromStatus(input.statusName, this.doneOptionName);
    const base = item?.base ?? null;
    const baseLane = base?.status ?? '';
    const baseState = stateFromStatus(baseLane, this.doneOptionName);

    if (item === null || baseState !== next) {
      await this.projectManagement.setTaskState(input.url, next);
    }

    await this.boardStatus.execute({
      projectName: input.projectName,
      connectionSlug: input.connectionSlug,
      url: input.url,
      statusName: input.statusName,
    });

    if (item === null) {
      return;
    }

    if (base !== null) {
      base.status = input.statusName;
      base.completedAt = next === 'closed' ? (base.completedAt ?? '') : null;
      await this.syncState.setMirrorItem(
        input.projectName,
        input.connectionSlug,
        input.url,
        {
          entityId: item.entityId,
          base,
        },
      );
    }
  }
}
