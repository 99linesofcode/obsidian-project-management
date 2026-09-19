import { App, FuzzySuggestModal } from 'obsidian';
import type { PromoteCardAction } from '../Domain/Actions/PromoteCardAction.js';
import type { BoardItemData } from '../Domain/DataTransferObjects/BoardItemData.js';
import type { ProjectManagementPort } from '../Domain/Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Domain/Ports/SyncStatePort.js';

// Obsidian runs in a browser where MouseEvent/KeyboardEvent are DOM globals;
// the node type environment does not declare them. Alias them so the modal's
// onChooseItem override can name them, as SyncScheduler does for window.
type MouseEvent = unknown;
type KeyboardEvent = unknown;

// A candidate in the promote-card modal: the draft card plus the project it
// belongs to and the repo to convert it into, so the display can be prefixed
// and the note lands in the right project folder.
export interface PromoteCardSuggestion {
  item: BoardItemData;
  projectName: string;
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
      const identity = await this.syncState.getIdentity(projectName);
      if (!identity) {
        continue;
      }
      const boardItems = await this.port.fetchBoardItems(
        identity.projectNodeId,
      );
      for (const item of boardItems) {
        if (item.type !== 'DRAFT_ISSUE') {
          continue;
        }
        items.push({ item, projectName, repoNodeId: identity.repoNodeId });
      }
    }
    this.items = items;
    super.onOpen();
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
    _evt: MouseEvent | KeyboardEvent,
  ): void {
    void this.promote.execute({
      itemId: item.item.itemId,
      repoNodeId: item.repoNodeId,
      projectName: item.projectName,
    });
  }
}
