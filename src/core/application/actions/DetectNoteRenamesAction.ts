import { normalizedStem } from '../../domain/stemOf.js';
import type { NoteEnumeratorPort } from '../../port/NoteEnumeratorPort.js';
import type { TrackedEntityPort } from '../../port/TrackedEntityPort.js';

export interface DetectNoteRenamesInput {
  projectName: string;
  syncedAt: string;
}

export class DetectNoteRenamesAction {
  constructor(
    private readonly vault: NoteEnumeratorPort,
    private readonly syncState: TrackedEntityPort,
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

    const records = (
      await this.syncState.listEntities(input.projectName)
    ).filter((record) =>
      record.notePath.startsWith(`Projecten/${input.projectName}/`),
    );
    const trackedPaths = new Set(records.map((record) => record.notePath));

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
      const newPath = untrackedByStem
        .get(normalizedStem(record.notePath))
        ?.shift();
      if (newPath === undefined) {
        continue;
      }
      await this.syncState.setEntity({ ...record, notePath: newPath });
    }
  }
}
