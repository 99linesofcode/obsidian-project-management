import type { SyncStatePort } from '../Ports/SyncStatePort.js';

export interface RelocateTaskStatusInput {
  oldPath: string;
  newPath: string;
}

// UC: when a task note is renamed by hand, its Status record follows. Obsidian
// rewrites the to-dos' affiliation wikilinks on rename, so only the plugin's
// own bookkeeping — the record's notePath — needs moving.
export class RelocateTaskStatusAction {
  constructor(private readonly syncState: SyncStatePort) {}

  async execute(input: RelocateTaskStatusInput): Promise<void> {
    const record = await this.syncState.findByNotePath(input.oldPath);
    if (!record) {
      return;
    }
    await this.syncState.set({ ...record, notePath: input.newPath });
  }
}