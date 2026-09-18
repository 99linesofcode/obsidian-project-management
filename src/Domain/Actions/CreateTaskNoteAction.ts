import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { taskStatusFromState } from '../Enums/TaskStatus.js';
import type { Status } from '../Models/Status.js';
import { TaskNoteMapper } from '../Notes/TaskNoteMapper.js';
import { hash } from '../Notes/hash.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';

export interface CreateTaskNoteInput {
  task: TaskData;
  projectName: string;
  syncedAt: string;
}

// UC2: materialise a task note. Idempotent — if the note already exists it is
// left untouched. Otherwise the note is created and its Status record written.
export class CreateTaskNoteAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: CreateTaskNoteInput): Promise<void> {
    const { path, content } = TaskNoteMapper.map(input.task, {
      projectName: input.projectName,
      syncedAt: input.syncedAt,
    });

    const existing = await this.vault.getNoteByPath(path);
    if (existing) {
      return;
    }

    await this.vault.createNote(path, content);

    const status: Status = {
      url: input.task.url,
      remoteId: input.task.remoteId,
      lastSyncedBodyHash: hash(input.task.body),
      lastSyncedRemoteUpdatedAt: input.task.updatedAt,
      lastSyncedStatus: taskStatusFromState(input.task.state),
    };
    await this.syncState.set(status);
  }
}
