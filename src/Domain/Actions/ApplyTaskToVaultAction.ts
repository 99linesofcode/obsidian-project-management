import type { GithubTaskData } from '../DataTransferObjects/GithubTaskData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { withChecklistLinks } from '../Notes/Checklist.js';
import { TaskNoteMapper, slugify } from '../Notes/TaskNoteMapper.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import { hash } from '../Notes/hash.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { CompleteTaskCascadeAction } from './CompleteTaskCascadeAction.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';

export interface ApplyTaskToVaultInput {
  // The winning canonical task — the remote's when the remote won.
  task: TaskData;
  // The vault's current canonical task, or null when no note exists yet.
  current: TaskData | null;
  projectName: string;
  syncedAt: string;
}

// The vault writer: renders a winning canonical task onto its note, writing
// only the fields that differ. Absorbs the write paths of ApplyRemoteChange
// (rename on title change, body/status rewrite, checklist re-linking) and
// CreateTaskNote (note creation for an untracked issue, look-up-before-create).
// The note body carries the checklist line; the checklist ↔ to-do consistency
// itself runs as a retained chain step (it must run for every task note, not
// only on a pull). The dt-13 cascade rule (t6) lives in the composed
// CompleteTaskCascadeAction and fires here whenever a done status is applied,
// whatever origin the winning task came from.
export class ApplyTaskToVaultAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly taskTemplatePath: string,
    private readonly completeTaskCascade: CompleteTaskCascadeAction,
  ) {}

  async execute(input: ApplyTaskToVaultInput): Promise<void> {
    // An untracked issue has no note: materialise it. The create action is
    // idempotent (look-up-before-create), so a note that already exists is
    // left untouched.
    if (input.current === null) {
      await this.createTaskNote.execute({
        task: toGithubTaskData(input.task),
        projectName: input.projectName,
        syncedAt: input.syncedAt,
        statusName: input.task.status,
      });
      await this.completeTaskCascade.execute({
        notePath: this.taskNotePath(input.task, input.projectName),
        projectName: input.projectName,
        syncedAt: input.syncedAt,
      });
      return;
    }

    const template = await this.readTemplate();
    // The note body is the remote body with vault links re-attached, so a
    // remote-driven rewrite keeps the checklist items linked to their to-dos.
    const linkedBody = await this.linkedBody(
      input.task.body,
      input.projectName,
    );
    const rendered = TaskNoteMapper.render(
      template,
      { ...input.task, body: linkedBody },
      {
        projectName: input.projectName,
        syncedAt: input.syncedAt,
        statusName: input.task.status,
      },
    );

    const existing = await this.vault.getNoteByPath(input.current.notePath);
    if (input.current.notePath !== rendered.path) {
      await this.vault.renameNote(input.current.notePath, rendered.path);
    }
    if ((existing?.content ?? '') !== rendered.content) {
      await this.vault.writeNote(rendered.path, rendered.content);
    }

    // The dt-13 fan-out: a done status applied here also completes the task's
    // checklist line and its still-open to-dos; a reopen mirrors the checklist
    // line but never reopens the to-dos (asymmetric, by decision).
    await this.completeTaskCascade.execute({
      notePath: rendered.path,
      projectName: input.projectName,
      syncedAt: input.syncedAt,
    });

    await this.refreshRecord(input, rendered.path);
  }

  // The mapped note path for a task — used to reach a freshly created note for
  // the cascade without re-rendering it.
  private taskNotePath(task: TaskData, projectName: string): string {
    return TaskNoteMapper.map(toGithubTaskData(task), {
      projectName,
      syncedAt: '',
      statusName: task.status,
    }).path;
  }

  // The template note's content, or null when it does not exist — render
  // falls back to the built-in frontmatter.
  private async readTemplate(): Promise<string | null> {
    const note = await this.vault.getNoteByPath(this.taskTemplatePath);
    return note?.content ?? null;
  }

  // Re-attaches vault links to the remote body's checklist items. A to-do's
  // title is only recoverable from its filename slug, so an item links to the
  // first to-do whose filename stem equals slugify(item text); an item with no
  // matching to-do stays unlinked and re-promotes through the checklist
  // lifecycle on the next pass.
  private async linkedBody(body: string, projectName: string): Promise<string> {
    const bySlug = await this.todoPathsBySlug(projectName);
    return withChecklistLinks(
      body,
      (text) => bySlug.get(slugify(text)) ?? null,
    );
  }

  // The project's to-do paths keyed by filename stem. Only notes that parse as
  // to-dos are considered; on a slug collision the first path wins.
  private async todoPathsBySlug(
    projectName: string,
  ): Promise<Map<string, string>> {
    const bySlug = new Map<string, string>();
    const folder = `Projecten/${projectName}/todos`;

    for (const path of await this.vault.listNotesInFolder(folder)) {
      const note = await this.vault.getNoteByPath(path);
      if (!note || ToDoNoteParser.parse(note.content) === null) {
        continue;
      }
      const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
      if (!bySlug.has(stem)) {
        bySlug.set(stem, path);
      }
    }

    return bySlug;
  }

  // The record reflects the remote as of the write: the winning task's body
  // hash, updatedAt, lane and title, with the note path the note now lives at.
  private async refreshRecord(
    input: ApplyTaskToVaultInput,
    notePath: string,
  ): Promise<void> {
    const { task } = input;
    await this.syncState.set({
      url: task.url,
      remoteId: task.remoteId,
      nodeId: task.nodeId,
      todoistId: '',
      notePath,
      title: task.title,
      body: hash(task.body),
      status: task.status,
      completed: task.completed,
      parent: null,
      labels: [...task.labels],
      updatedAt: task.updatedAt,
    });
  }
}

// The canonical task in the provider transport shape the note renderer and the
// create action consume. Only the fields the note carries are meaningful.
function toGithubTaskData(task: TaskData): GithubTaskData {
  return {
    url: task.url,
    remoteId: task.remoteId,
    nodeId: task.nodeId,
    title: task.title,
    body: task.body,
    state: task.completed ? 'closed' : 'open',
    updatedAt: task.updatedAt,
    labels: [...task.labels],
  };
}
