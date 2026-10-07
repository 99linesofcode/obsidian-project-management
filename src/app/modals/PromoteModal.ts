import { App, FuzzySuggestModal } from 'obsidian';
import type { PromoteIssueAction } from '../../tasks/PromoteIssueAction.js';
import type { GithubTaskData } from '../../github/GithubTaskData.js';
import type { ProjectManagementPort } from '../../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../../shared/SyncStatePort.js';

type ChooseEvent = Parameters<
  FuzzySuggestModal<PromoteSuggestion>['onChooseItem']
>[1];

export interface PromoteSuggestion {
  task: GithubTaskData;
  projectName: string;
  connectionSlug: string;
}

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

  onChooseItem(item: PromoteSuggestion, _evt: ChooseEvent): void {
    void this.promote.execute({
      url: item.task.url,
      label: 'type: task',
      projectName: item.projectName,
      connectionSlug: item.connectionSlug,
    });
  }
}
