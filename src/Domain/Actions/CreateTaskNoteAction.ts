import type { GithubTaskData } from '../DataTransferObjects/GithubTaskData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { TaskNoteMapper } from '../Notes/TaskNoteMapper.js';
import { hash } from '../Notes/hash.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';

export interface CreateTaskNoteInput {
  task: GithubTaskData;
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

    // The canonical snapshot record: the body carries the issue-body hash (the
    // comparable fingerprint), the lane is preserved verbatim. `completed` is
    // re-derived from the lane at diff time, so a default here is not
    // load-bearing.
    const snapshot: TaskData = {
      url: input.task.url,
      remoteId: input.task.remoteId,
      nodeId: input.task.nodeId,
      todoistId: '',
      notePath: path,
      title: input.task.title,
      body: hash(input.task.body),
      status: input.statusName,
      completed: false,
      parent: null,
      labels: [...input.task.labels],
      updatedAt: input.task.updatedAt,
    };
    await this.syncState.set(snapshot);
  }

  // The template note's content, or null when it does not exist — render
  // falls back to the built-in frontmatter.
  private async readTemplate(): Promise<string | null> {
    const note = await this.vault.getNoteByPath(this.taskTemplatePath);
    return note?.content ?? null;
  }
}
