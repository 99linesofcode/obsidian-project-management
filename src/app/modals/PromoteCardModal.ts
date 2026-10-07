import { App, FuzzySuggestModal } from 'obsidian';
import type { PromoteCardAction } from '../../tasks/PromoteCardAction.js';
import type { BoardItemData } from '../../shared/BoardItemData.js';
import type { ProjectManagementPort } from '../../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../../shared/SyncStatePort.js';

type ChooseEvent = Parameters<
  FuzzySuggestModal<PromoteCardSuggestion>['onChooseItem']
>[1];

export interface PromoteCardSuggestion {
  item: BoardItemData;
  projectName: string;
  connectionSlug: string;
  repoNodeId: string;
}

export class PromoteCardModal extends FuzzySuggestModal<PromoteCardSuggestion> {
  private items: PromoteCardSuggestion[] = [];

  constructor(
    app: App,
    private readonly getProjectNames: () => string[],
    private readonly syncState: SyncStatePort,
    private readonly port: ProjectManagementPort,
    private readonly promote: PromoteCardAction,
  ) {
    super(app);
  }

  override async onOpen(): Promise<void> {
    const items: PromoteCardSuggestion[] = [];
    for (const projectName of this.getProjectNames()) {
      for (const { slug, identity } of await this.syncState.listIdentities(
        projectName,
      )) {
        if (!identity.projectNodeId) {
          continue;
        }
        const boardItems = await this.port.fetchBoardItems(
          identity.projectNodeId,
        );
        for (const item of boardItems) {
          if (item.type !== 'DRAFT_ISSUE') {
            continue;
          }
          items.push({
            item,
            projectName,
            connectionSlug: slug,
            repoNodeId: identity.repoNodeId,
          });
        }
      }
    }
    this.items = items;
    await super.onOpen();
  }

  getItems(): PromoteCardSuggestion[] {
    return this.items;
  }

  getItemText(item: PromoteCardSuggestion): string {
    return `${item.projectName}: ${item.item.draftTitle ?? ''}`;
  }

  onChooseItem(item: PromoteCardSuggestion, _evt: ChooseEvent): void {
    void this.promote.execute({
      itemId: item.item.itemId,
      repoNodeId: item.repoNodeId,
      projectName: item.projectName,
      connectionSlug: item.connectionSlug,
    });
  }
}
