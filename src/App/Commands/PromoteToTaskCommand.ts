import type ProjectManagementPlugin from '../../main.js';
import { PromoteModal } from '../PromoteModal.js';
import type { PromoteIssueAction } from '../../Domain/Actions/PromoteIssueAction.js';
import type { ProjectManagementPort } from '../../Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../../Domain/Ports/SyncStatePort.js';

// UC10: one command, one trigger. Wires the 'promote-to-task' command to open
// the promote modal. Thin driving-side wiring; the logic lives in the action.
export class PromoteToTaskCommand {
  constructor(
    private readonly getProjectNames: () => string[],
    private readonly syncState: SyncStatePort,
    private readonly port: ProjectManagementPort,
    private readonly promote: PromoteIssueAction,
  ) {}

  register(plugin: ProjectManagementPlugin): void {
    plugin.addCommand({
      id: 'promote-to-task',
      name: 'Promote a GitHub issue as a task',
      callback: () => {
        new PromoteModal(
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
