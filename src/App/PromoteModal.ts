import { App, FuzzySuggestModal } from 'obsidian';
import type { PromoteIssueAction } from '../Domain/Actions/PromoteIssueAction.js';
import type { TaskData } from '../Domain/DataTransferObjects/TaskData.js';
import type { ProjectManagementPort } from '../Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Domain/Ports/SyncStatePort.js';

// Obsidian runs in a browser where MouseEvent/KeyboardEvent are DOM globals;
// the node type environment does not declare them. Alias them so the modal's
// onChooseItem override can name them, as SyncScheduler does for window.
type MouseEvent = unknown;
type KeyboardEvent = unknown;

// A candidate in the promote modal: the unpromoted issue plus the project it
// belongs to, so the display can be prefixed and the note lands in the right
// project folder.
export interface PromoteSuggestion {
  task: TaskData;
  projectName: string;
}

// UC10: pick an unpromoted GitHub issue to promote into a tracked task. Thin
// driving-side UI: lists unpromoted issues across the discovered projects
// (prefixed with the project name so entries from different projects are
// distinguishable) and hands the chosen one to the promote action. The logic
// lives in PromoteIssueAction; this modal only wires the pick to the action.
export class PromoteModal extends FuzzySuggestModal<PromoteSuggestion> {
  private items: PromoteSuggestion[] = [];

  constructor(
    app: App,
    private readonly getProjectNames: () => string[],
    private readonly syncState: SyncStatePort,
    private readonly port: ProjectManagementPort,
    private readonly promote: PromoteIssueAction,
  ) {
    super(app);
  }

  override async onOpen(): Promise<void> {
    const items: PromoteSuggestion[] = [];
    for (const projectName of this.getProjectNames()) {
      const identity = await this.syncState.getIdentity(projectName);
      if (!identity) {
        continue;
      }
      const issues = await this.port.fetchUnpromotedIssues(identity.repoUrl);
      for (const issue of issues) {
        items.push({ task: issue, projectName });
      }
    }
    this.items = items;
    super.onOpen();
  }

  getItems(): PromoteSuggestion[] {
    return this.items;
  }

  getItemText(item: PromoteSuggestion): string {
    return `${item.projectName}: ${item.task.title}`;
  }

  // The event is part of the FuzzySuggestModal contract but unused here; the
  // pick only needs the chosen issue.
  onChooseItem(
    item: PromoteSuggestion,
    _evt: MouseEvent | KeyboardEvent,
  ): void {
    void this.promote.execute({
      url: item.task.url,
      label: 'type: task',
      projectName: item.projectName,
    });
  }
}
