import { App, FuzzySuggestModal } from 'obsidian';
import type { PromoteCardAction } from '../../tasks/PromoteCardAction.js';
import type { BoardItemData } from '../../shared/BoardItemData.js';
import type { ProjectManagementPort } from '../../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../../shared/SyncStatePort.js';

// The event type the base FuzzySuggestModal hands onChooseItem. The DOM lib is
// not in the type environment, so it is derived from the base signature rather
// than named directly.
type ChooseEvent = Parameters<
  FuzzySuggestModal<PromoteCardSuggestion>['onChooseItem']
>[1];

// A candidate in the promote-card modal: the draft card plus the project it
// belongs to and the repo to convert it into, so the display can be prefixed
// and the note lands in the right project folder.
export interface PromoteCardSuggestion {
  item: BoardItemData;
  projectName: string;
  connectionSlug: string;
  repoNodeId: string;
}

// UC11: pick a draft card to promote into a real GitHub issue. Thin
// driving-side UI: lists draft cards across the discovered projects (prefixed
// with the project name so entries from different projects are
// distinguishable) and hands the chosen one to the promote action. The logic
// lives in PromoteCardAction; this modal only wires the pick to the action.
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

  // The event is part of the FuzzySuggestModal contract but unused here; the
  // pick only needs the chosen card.
  onChooseItem(
    item: PromoteCardSuggestion,
    _evt: ChooseEvent,
  ): void {
    void this.promote.execute({
      itemId: item.item.itemId,
      repoNodeId: item.repoNodeId,
      projectName: item.projectName,
      connectionSlug: item.connectionSlug,
    });
  }
}
