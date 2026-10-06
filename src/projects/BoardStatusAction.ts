import { boardOptionIDByName } from './boardOptionIDByName.js';
import type { ProjectManagementPort } from '../github/ProjectManagementPort.js';
import type { SyncStatePort } from '../registry/SyncStatePort.js';

export interface BoardStatusInput {
  projectName: string;
  url: string;
  // The project's Status option name to move the card to.
  statusName: string;
}

// UC7: mirror a note's status onto the board's Status column. Resolves the
// project's stored identity, maps the status name to a board option id, and
// writes it. A project with no stored identity is board-less and skipped
// silently.
//
// The write is GATED: the registry record's github base lane already resolves
// to a board option, so a move to the lane the card already sits in is skipped.
// The gate IS the diff — only a real lane change reaches the board.
export class BoardStatusAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
  ) {}

  async execute(input: BoardStatusInput): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    if (!identity) {
      return;
    }

    const optionId = boardOptionIDByName(
      identity.statusOptions,
      input.statusName,
    );

    // The base lane is the current board lane: when it resolves to the same
    // option, the card is already in step. An absent base (a pre-first-sync
    // record) or a lane the board no longer carries has no option to compare,
    // so the write proceeds.
    const item = await this.syncState.findMirrorItem('github', input.url);
    const currentStatus = item?.base?.status ?? '';
    const current = identity.statusOptions.find(
      (option) => option.name === currentStatus,
    );
    if (current?.id === optionId) {
      return;
    }

    await this.projectManagement.setBoardStatus(
      identity.projectNodeId,
      identity.statusFieldId,
      input.url,
      optionId,
    );
  }
}
