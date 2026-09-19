import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { taskStatusFromState } from '../Enums/TaskStatus.js';
import type { Status } from '../Models/Status.js';
import { TaskNoteMapper } from '../Notes/TaskNoteMapper.js';
import { hash } from '../Notes/hash.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';

export interface ApplyRemoteChangeInput {
  task: TaskData;
  projectName: string;
  syncedAt: string;
}

// UC3: mirror a remote change onto an existing task note. Locates the note
// via its Status record, re-maps the content, renames on a title change,
// rewrites on a body/status change, and updates the Status record. Skips
// silently when nothing changed. A task with no Status record is treated as
// new and delegated to CreateTaskNoteAction.
export class ApplyRemoteChangeAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
  ) {}

  async execute(input: ApplyRemoteChangeInput): Promise<void> {
    const status = await this.syncState.get(input.task.url);
    if (!status) {
      await this.createTaskNote.execute({
        task: input.task,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
      });
      return;
    }

    const { path, content } = TaskNoteMapper.map(input.task, {
      projectName: input.projectName,
      syncedAt: input.syncedAt,
    });
    const newHash = hash(input.task.body);
    const newStatus = taskStatusFromState(input.task.state);

    // Nothing changed on the remote — leave the note and record untouched.
    // A title change shows up as a different mapped path, so it is included
    // in the comparison to avoid skipping a rename.
    if (
      status.notePath === path &&
      status.lastSyncedBodyHash === newHash &&
      status.lastSyncedStatus === newStatus &&
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

    const updated: Status = {
      url: input.task.url,
      remoteId: input.task.remoteId,
      notePath: path,
      lastSyncedBodyHash: newHash,
      lastSyncedRemoteUpdatedAt: input.task.updatedAt,
      lastSyncedStatus: newStatus,
      lastSyncedTitle: input.task.title,
    };
    await this.syncState.set(updated);
  }
}
