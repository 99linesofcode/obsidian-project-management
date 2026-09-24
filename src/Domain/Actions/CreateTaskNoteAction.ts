import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { Status } from '../Models/Status.js';
import { TaskNoteMapper } from '../Notes/TaskNoteMapper.js';
import { hash } from '../Notes/hash.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';

export interface CreateTaskNoteInput {
  task: TaskData;
  projectName: string;
  syncedAt: string;
  // The project's Status option name the task starts in.
  statusName: string;
}

// UC2: materialise a task note. Idempotent — if the note already exists it is
// left untouched. Otherwise the note is created and its Status record written.
export class CreateTaskNoteAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly taskTemplatePath: string,
  ) {}

  async execute(input: CreateTaskNoteInput): Promise<void> {
    const template = await this.readTemplate();
    const { path, content } = TaskNoteMapper.render(template, input.task, {
      projectName: input.projectName,
      syncedAt: input.syncedAt,
      statusName: input.statusName,
    });

    const existing = await this.vault.getNoteByPath(path);
    if (existing) {
      return;
    }

    await this.vault.createNote(path, content);

    const status: Status = {
      url: input.task.url,
      remoteId: input.task.remoteId,
      notePath: path,
      lastSyncedBodyHash: hash(input.task.body),
      lastSyncedRemoteUpdatedAt: input.task.updatedAt,
      lastSyncedStatus: input.statusName,
      lastSyncedTitle: input.task.title,
    };
    await this.syncState.set(status);
  }

  // The template note's content, or null when it does not exist — render
  // falls back to the built-in frontmatter.
  private async readTemplate(): Promise<string | null> {
    const note = await this.vault.getNoteByPath(this.taskTemplatePath);
    return note?.content ?? null;
  }
}
