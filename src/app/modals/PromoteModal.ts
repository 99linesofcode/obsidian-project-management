import { App, FuzzySuggestModal } from 'obsidian';
import type { PromoteIssueAction } from '../../tasks/PromoteIssueAction.js';
import type { GithubTaskData } from '../../github/GithubTaskData.js';
import type { ProjectManagementPort } from '../../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../../shared/SyncStatePort.js';

// The event type the base FuzzySuggestModal hands onChooseItem. The DOM lib is
// not in the type environment, so it is derived from the base signature rather
// than named directly.
type ChooseEvent = Parameters<
  FuzzySuggestModal<PromoteSuggestion>['onChooseItem']
>[1];

// A candidate in the promote modal: the unpromoted issue plus the project it
// belongs to, so the display can be prefixed and the note lands in the right
// project folder.
export interface PromoteSuggestion {
  task: GithubTaskData;
  projectName: string;
  connectionSlug: string;
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
      for (const { slug, identity } of await this.syncState.listIdentities(
        projectName,
      )) {
        if (!identity.repoUrl) {
          continue;
        }
        const issues = await this.port.fetchUnpromotedIssues(identity.repoUrl);
        for (const issue of issues) {
          items.push({ task: issue, projectName, connectionSlug: slug });
        }
      }
    }
    this.items = items;
    await super.onOpen();
  }

  getItems(): PromoteSuggestion[] {
    return this.items;
  }

  getItemText(item: PromoteSuggestion): string {
    return `${item.projectName}: ${item.task.title}`;
  }

  // The event is part of the FuzzySuggestModal contract but unused here; the
  // pick only needs the chosen issue.
  onChooseItem(item: PromoteSuggestion, _evt: ChooseEvent): void {
    void this.promote.execute({
      url: item.task.url,
      label: 'type: task',
      projectName: item.projectName,
      connectionSlug: item.connectionSlug,
    });
  }
}
