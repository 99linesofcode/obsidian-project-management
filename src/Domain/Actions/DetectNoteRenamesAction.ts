import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface DetectNoteRenamesInput {
  projectName: string;
  syncedAt: string;
}

// UC: detect hand-renamed notes from snapshot drift, replacing the old
// `renamed` trigger kind. Identity is the vault-owned uuid in a note's
// frontmatter, so a rename is a FIELD UPDATE on the registry record — the
// note's location moved, its id and its mirrors did not. For every record
// whose note is no longer at its recorded path, the action looks for the
// current note carrying the same id and moves the record's notePath to it. No
// re-key, no handle churn, no two-store bookkeeping.
//
// A record whose note is gone and has no id-matching current note is left
// alone: the deletion sweep owns a genuine deletion, and a note that lost its
// id is re-registered by the id backfill on the next chain start.
export class DetectNoteRenamesAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: DetectNoteRenamesInput): Promise<void> {
    const currentPaths: string[] = [];
    for (const folder of [
      `Projecten/${input.projectName}/taken`,
      `Projecten/${input.projectName}/todos`,
    ]) {
      currentPaths.push(...(await this.vault.listNotesInFolder(folder)));
    }
    const currentSet = new Set(currentPaths);

    // The id → current path index: the durable anchor survives a rename, so a
    // note found at a new path still resolves to its record.
    const pathById = new Map<string, string>();
    for (const path of currentPaths) {
      const note = await this.vault.getNoteByPath(path);
      if (note === null) {
        continue;
      }
      const id = splitFrontmatter(note.content)?.fields.get('id') ?? '';
      if (id !== '' && !pathById.has(id)) {
        pathById.set(id, path);
      }
    }

    const prefix = `Projecten/${input.projectName}/`;
    for (const record of await this.syncState.list()) {
      if (!record.notePath.startsWith(prefix)) {
        continue;
      }
      if (currentSet.has(record.notePath)) {
        continue;
      }
      const newPath = pathById.get(record.id);
      if (newPath === undefined) {
        continue;
      }
      // The id and the mirrors are untouched; only the location moves.
      await this.syncState.set({ ...record, notePath: newPath });
    }
  }
}
