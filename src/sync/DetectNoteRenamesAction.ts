import { normalizedStem } from '../shared/stemOf.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';

export interface DetectNoteRenamesInput {
  projectName: string;
  syncedAt: string;
}

// UC: detect hand-renamed notes from snapshot drift, replacing the old
// `renamed` trigger kind. A rename is a FIELD UPDATE on the registry record —
// the note's location moved, its uuid and its mirrors did not.
//
// WHY the stem pairs a rename: the frontmatter id is gone by decision (dt-20),
// so the note no longer carries a machine anchor that survives a hand-rename.
// The filename stem is the offline-rename recovery key: a record whose note
// vanished from its recorded path is paired with an untracked note of the same
// stem, and the record's notePath moves to it. A LIVE rename still flows
// through the vault rename event (RelocateTaskStatusAction / RelinkRenamedTodo),
// so this pass only recovers a rename the plugin did not observe.
//
// A record whose note is gone and has no same-stem current note is left alone:
// the deletion sweep owns a genuine deletion.
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

    const records = (await this.syncState.listEntities(input.projectName)).filter(
      (record) =>
        record.notePath.startsWith(`Projecten/${input.projectName}/`),
    );
    const trackedPaths = new Set(records.map((record) => record.notePath));

    // Untracked current notes, grouped by recovery stem. Sorted so the pairing
    // is deterministic when two notes share a stem.
    const untrackedByStem = new Map<string, string[]>();
    for (const path of [...currentPaths].sort()) {
      if (trackedPaths.has(path)) {
        continue;
      }
      const stem = normalizedStem(path);
      const list = untrackedByStem.get(stem) ?? [];
      list.push(path);
      untrackedByStem.set(stem, list);
    }

    for (const record of records) {
      if (currentSet.has(record.notePath)) {
        continue;
      }
      // The same-stem untracked note, consumed so one note cannot absorb two
      // records.
      const newPath = untrackedByStem.get(normalizedStem(record.notePath))?.shift();
      if (newPath === undefined) {
        continue;
      }
      // The uuid and the mirrors are untouched; only the location moves.
      await this.syncState.setEntity({ ...record, notePath: newPath });
    }
  }
}

