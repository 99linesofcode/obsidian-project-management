import { boardOptionIDByName } from '../Board/boardOptionIDByName.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';

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
    await this.projectManagement.setBoardStatus(
      identity.projectNodeId,
      identity.statusFieldId,
      input.url,
      optionId,
    );
  }
}
