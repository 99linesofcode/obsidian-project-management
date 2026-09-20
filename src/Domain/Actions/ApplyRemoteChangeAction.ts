import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { Status } from '../Models/Status.js';
import { TaskNoteMapper } from '../Notes/TaskNoteMapper.js';
import { hash } from '../Notes/hash.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { BoardStatusAction } from './BoardStatusAction.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';

export interface ApplyRemoteChangeInput {
  task: TaskData;
  projectName: string;
  syncedAt: string;
  // The project's Status option name the task's issue state implies —
  // computed by the sync from the project's identity.
  statusName: string;
}

// UC3/UC7: mirror a remote change onto an existing task note. Locates the note
// via its Status record, re-maps the content, renames on a title change,
// rewrites on a body/status change, mirrors a status flip onto the board, and
// updates the Status record. Skips silently when nothing changed. A task with
// no Status record is treated as new and delegated to CreateTaskNoteAction.
export class ApplyRemoteChangeAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly boardStatus: BoardStatusAction,
  ) {}

  async execute(input: ApplyRemoteChangeInput): Promise<void> {
    const status = await this.syncState.get(input.task.url);
    if (!status) {
      await this.createTaskNote.execute({
        task: input.task,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
        statusName: input.statusName,
      });
      return;
    }

    const { path, content } = TaskNoteMapper.map(input.task, {
      projectName: input.projectName,
      syncedAt: input.syncedAt,
      statusName: input.statusName,
    });
    const newHash = hash(input.task.body);

    // Nothing changed on the remote — leave the note and record untouched.
    // A title change shows up as a different mapped path, so it is included
    // in the comparison to avoid skipping a rename.
    if (
      status.notePath === path &&
      status.lastSyncedBodyHash === newHash &&
      status.lastSyncedStatus === input.statusName &&
      status.lastSyncedRemoteUpdatedAt === input.task.updatedAt
    ) {
      return;
    }

    const existing = await this.vault.getNoteByPath(status.notePath);

    if (status.notePath !== path) {
      await this.vault.renameNote(status.notePath, path);
    }

    const existingContent = existing?.content ?? '';
    if (existingContent !== content) {
      await this.vault.writeNote(path, content);
    }

    // A remote status flip is mirrored onto the board so the card stays in
    // step with the issue even when the change came from outside the board.
    if (input.statusName !== status.lastSyncedStatus) {
      await this.boardStatus.execute({
        projectName: input.projectName,
        url: input.task.url,
        statusName: input.statusName,
      });
    }

    const updated: Status = {
      url: input.task.url,
      remoteId: input.task.remoteId,
      notePath: path,
      lastSyncedBodyHash: newHash,
      lastSyncedRemoteUpdatedAt: input.task.updatedAt,
      lastSyncedStatus: input.statusName,
      lastSyncedTitle: input.task.title,
    };
    await this.syncState.set(updated);
  }
}
