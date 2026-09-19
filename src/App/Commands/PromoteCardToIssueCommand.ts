import type ProjectManagementPlugin from '../../main.js';
import { PromoteCardModal } from '../PromoteCardModal.js';
import type { PromoteCardAction } from '../../Domain/Actions/PromoteCardAction.js';
import type { ProjectManagementPort } from '../../Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../Domain/Ports/SyncStatePort.js';

// UC11: one command, one trigger. Wires the 'promote-card-to-issue' command
// to open the promote-card modal. Thin driving-side wiring; the logic lives
// in the action.
export class PromoteCardToIssueCommand {
  constructor(
    private readonly getProjectNames: () => string[],
    private readonly syncState: SyncStatePort,
    private readonly port: ProjectManagementPort,
    private readonly promote: PromoteCardAction,
  ) {}

  register(plugin: ProjectManagementPlugin): void {
    plugin.addCommand({
      id: 'promote-card-to-issue',
      name: 'Promote a draft card to a GitHub issue',
      callback: () => {
        new PromoteCardModal(
          plugin.app,
          this.getProjectNames,
          this.syncState,
          this.port,
          this.promote,
        ).open();
      },
    });
  }
}
