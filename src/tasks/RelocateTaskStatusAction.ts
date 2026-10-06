import type { SyncStatePort } from '../registry/SyncStatePort.js';

export interface RelocateTaskStatusInput {
  oldPath: string;
  newPath: string;
}

// UC: when a task note is renamed by hand, its registry record follows.
// Obsidian rewrites the to-dos' affiliation wikilinks on rename, so only the
// plugin's own bookkeeping — the record's notePath — needs moving. The record's
// mirrors (github handle + base, todoist handle + base) travel with it, so a
// task note renamed by hand keeps every twin anchor; the old two-store Todoist
// re-key is gone with the registry.
export class RelocateTaskStatusAction {
  constructor(private readonly syncState: SyncStatePort) {}

  async execute(input: RelocateTaskStatusInput): Promise<void> {
    const record = await this.syncState.findByNotePath(input.oldPath);
    if (record) {
      await this.syncState.setEntity({ ...record, notePath: input.newPath });
    }
  }
}
