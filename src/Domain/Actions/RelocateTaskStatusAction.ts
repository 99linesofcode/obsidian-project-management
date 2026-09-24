import type { SyncStatePort } from '../Ports/SyncStatePort.js';

export interface RelocateTaskStatusInput {
  oldPath: string;
  newPath: string;
}

// UC: when a task note is renamed by hand, its Status record follows. Obsidian
// rewrites the to-dos' affiliation wikilinks on rename, so only the plugin's
// own bookkeeping — the record's notePath — needs moving. The TodoistState
// record follows too (t5): a task note renamed by a Todoist content rename or
// by hand must keep its twin anchor, or the next poll would capture the item as
// a fresh creation.
export class RelocateTaskStatusAction {
  constructor(private readonly syncState: SyncStatePort) {}

  async execute(input: RelocateTaskStatusInput): Promise<void> {
    const record = await this.syncState.findByNotePath(input.oldPath);
    if (record) {
      await this.syncState.set({ ...record, notePath: input.newPath });
    }

    // The adapter re-keys a record to its new notePath and evicts the old one
    // (one record per todoistId), so setting at the new path moves the anchor.
    const todoist = await this.syncState.getTodoistState(input.oldPath);
    if (todoist) {
      await this.syncState.setTodoistState(input.newPath, {
        ...todoist,
        notePath: input.newPath,
      });
    }
  }
}
