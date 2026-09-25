import { stemOf } from '../Notes/stemOf.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { RelinkRenamedTodoAction } from './RelinkRenamedTodoAction.js';
import type { RelocateTaskStatusAction } from './RelocateTaskStatusAction.js';

export interface DetectNoteRenamesInput {
  projectName: string;
  syncedAt: string;
}

// UC: detect hand-renamed notes from snapshot drift, replacing the old
// `renamed` trigger kind. The vault rename event carried both paths; the chain
// only has the snapshot records, so it compares each record's notePath against
// the project's current vault paths and, for a record whose note is gone,
// composes the existing rename actions:
//
//   - a task note keeps its remote id in the filename, so the new path is the
//     current `taken/` note whose stem starts with `<remoteId>-`;
//   - a to-do note has no stable id in its content, so the new path is the
//     current `todos/` note no record claims. A single rename pairs cleanly;
//     simultaneous renames pair in order (an accepted interim ambiguity).
//
// A record whose note is gone and has no matching current note is left alone:
// the deletion sweep owns a genuine deletion, and the checklist sync restores
// a to-do whose filename drifted from its title.
export class DetectNoteRenamesAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly relinkRenamedTodo: RelinkRenamedTodoAction,
    private readonly relocateTaskStatus: RelocateTaskStatusAction,
  ) {}

  async execute(input: DetectNoteRenamesInput): Promise<void> {
    const takenFolder = `Projecten/${input.projectName}/taken`;
    const todoFolder = `Projecten/${input.projectName}/todos`;
    const takenPaths = await this.vault.listNotesInFolder(takenFolder);
    const todoPaths = await this.vault.listNotesInFolder(todoFolder);

    for (const record of await this.syncState.list()) {
      if (!record.notePath.startsWith(`${takenFolder}/`)) {
        continue;
      }
      if (takenPaths.includes(record.notePath)) {
        continue;
      }
      const newPath = takenPaths.find((path) =>
        stemOf(path).startsWith(`${record.remoteId}-`),
      );
      if (newPath !== undefined) {
        await this.relocateTaskStatus.execute({
          oldPath: record.notePath,
          newPath,
        });
      }
    }

    const recordedTodoPaths = new Set(
      (await this.syncState.listTodoistStates()).map((state) => state.notePath),
    );
    const unclaimed = todoPaths.filter((path) => !recordedTodoPaths.has(path));
    for (const record of await this.syncState.listTodoistStates()) {
      if (!record.notePath.startsWith(`${todoFolder}/`)) {
        continue;
      }
      if (todoPaths.includes(record.notePath)) {
        continue;
      }
      const newPath = unclaimed.shift();
      if (newPath !== undefined) {
        await this.relinkRenamedTodo.execute({
          oldPath: record.notePath,
          newPath,
          syncedAt: input.syncedAt,
        });
      }
    }
  }
}
