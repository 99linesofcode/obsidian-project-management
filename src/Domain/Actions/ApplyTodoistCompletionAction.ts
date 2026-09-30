import { Mirror } from '../DataTransferObjects/Mirror.js';
import { TaskData } from '../DataTransferObjects/TaskData.js';
import { ToDoNoteParser, withToDoStatus } from '../Notes/ToDoNoteParser.js';
import { VaultTaskMapper } from '../Mappers/VaultTaskMapper.js';
import { toDiffViewWithBody } from '../Reconciliation/toDiffView.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { EntityRecord, SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { ApplyTaskToVaultAction } from './ApplyTaskToVaultAction.js';

export interface ApplyTodoistCompletionInput {
  projectName: string;
  projectId: string;
  syncedAt: string;
}

// UC: pull remote completion changes into the vault (t4). A completion is
// caught by the completed-since query from the project's stored cursor; a
// reopen is caught by a twin reappearing in the active set while its base says
// completed — that is what tells a remote reopen from a vault-side completion,
// which the projection owns.
//
// The window covers BOTH to-do twins and task twins. Task twins used to be
// left to the task-side reconciliation, which defers pulls to the absorbers —
// the ownership gap: a completed task twin could be seen by neither and the
// note stayed open. A completed task twin now applies the done lane (with a
// completion stamp) through the vault writer, so the dt-13 cascade fires; a
// task twin active again while its base says completed reopens the note. To-dos
// keep their existing completion/reopen behavior.
//
// The applied completion stamp is the tick's syncedAt — the moment the sync
// observed the change — a full ISO datetime, never date-only. Every applied
// change (and every echo we skip) stamps the mirror's base so the next poll
// does not read our own write as a remote change. The cursor advances only
// after a successful pass: if either fetch throws, the window is retried next
// tick rather than skipped.
export class ApplyTodoistCompletionAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly applyToVault: ApplyTaskToVaultAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: ApplyTodoistCompletionInput): Promise<void> {
    const projectState = await this.syncState.getTodoistProjectState(
      input.projectName,
    );
    const since = projectState?.lastCompletedPoll || input.syncedAt;

    // Both fetches must succeed before any vault write or cursor move.
    const completed = await this.taskManager.fetchCompletedTasks(
      input.projectId,
      since,
    );
    const active = await this.taskManager.fetchActiveTasks(input.projectId);
    const activeById = new Map(active.map((task) => [task.id, task]));

    const records = (await this.syncState.list()).filter((record) =>
      record.notePath.startsWith(`Projecten/${input.projectName}/`),
    );
    const byHandle = new Map<string, EntityRecord>();
    for (const record of records) {
      const handle = record.mirrors.todoist?.handle ?? '';
      if (handle !== '') {
        byHandle.set(handle, record);
      }
    }

    for (const task of completed) {
      const record = byHandle.get(task.id);
      if (!record) {
        continue;
      }
      // Our own close: the base already says completed, so this entry is the
      // echo of a vault-driven completion, not a remote change.
      if (baseDone(record)) {
        continue;
      }
      await this.applyCompletion(record, task, input);
    }

    for (const record of records) {
      const handle = record.mirrors.todoist?.handle ?? '';
      const twin = handle === '' ? undefined : activeById.get(handle);
      // Not in the active set: still completed (or gone), no reopen to apply.
      if (!twin) {
        continue;
      }
      // The base said open, so an active twin is no change at all.
      if (!baseDone(record)) {
        continue;
      }
      await this.applyReopen(record, twin, input);
    }

    await this.syncState.setTodoistProjectState(input.projectName, {
      sections: projectState?.sections ?? {},
      lastCompletedPoll: input.syncedAt,
    });
  }

  // Completes a note the remote closed, then stamps the twin's base. A note
  // already completed is left alone (only the base moves). A task twin routes
  // through the vault writer so the done lane and the dt-13 cascade both fire.
  private async applyCompletion(
    record: EntityRecord,
    task: TodoistTaskData,
    input: ApplyTodoistCompletionInput,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(record.notePath);
    if (!note) {
      return;
    }
    const stamp = task.completedAt || input.syncedAt;

    if (isToDoPath(record.notePath, input.projectName)) {
      const parsed = ToDoNoteParser.parse(note.content);
      if (!parsed) {
        return;
      }
      if (parsed.status !== 'completed') {
        await this.vault.writeNote(
          record.notePath,
          withToDoStatus(note.content, 'completed', input.syncedAt),
        );
      }
      await this.stampBase(record, {
        title: task.content,
        status: 'completed',
        completedAt: stamp,
      });
      return;
    }

    const current = VaultTaskMapper.parseTask(note.content, record.notePath, {
      projectName: input.projectName,
      doneLane: this.doneOptionName,
    });
    if (!current) {
      return;
    }
    if (current.completedAt === null && current.status !== this.doneOptionName) {
      await this.applyToVault.execute({
        task: withCompletion(current, this.doneOptionName, stamp),
        current,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
        // A push leaves the github base to the GitHub writer: this completion
        // is a Todoist fact, not a GitHub one, so the issue's base must not
        // advance to the vault's new state.
        origin: 'push',
        record,
      });
    }
    await this.stampBase(record, {
      title: current.title,
      status: this.doneOptionName,
      completedAt: stamp,
    });
  }

  // Reopens a note the remote reopened, clearing the completion stamp, then
  // stamps the twin's base. A note already open is left alone. Task twins route
  // through the vault writer; the cascade's reopen is asymmetric, so a task's
  // to-dos stay completed.
  private async applyReopen(
    record: EntityRecord,
    twin: TodoistTaskData,
    input: ApplyTodoistCompletionInput,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(record.notePath);
    if (!note) {
      return;
    }

    if (isToDoPath(record.notePath, input.projectName)) {
      const parsed = ToDoNoteParser.parse(note.content);
      if (!parsed) {
        return;
      }
      if (parsed.status === 'completed') {
        await this.vault.writeNote(
          record.notePath,
          withToDoStatus(note.content, 'open', null),
        );
      }
      await this.stampBase(record, {
        title: twin.content,
        status: 'open',
        completedAt: null,
      });
      return;
    }

    const current = VaultTaskMapper.parseTask(note.content, record.notePath, {
      projectName: input.projectName,
      doneLane: this.doneOptionName,
    });
    if (!current) {
      return;
    }
    const identity = await this.syncState.getIdentity(input.projectName);
    const defaultLane = identity?.statusOptions[0]?.name ?? '';
    // A project without lanes has no lane to return to, so there is nothing to
    // pull out of done.
    if (defaultLane === '') {
      return;
    }
    const done =
      current.completedAt !== null || current.status === this.doneOptionName;
    if (done) {
      await this.applyToVault.execute({
        task: withReopen(current, defaultLane),
        current,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
        origin: 'push',
        record,
      });
    }
    await this.stampBase(record, {
      title: current.title,
      status: defaultLane,
      completedAt: null,
    });
  }

  // Writes the todoist mirror's base as a diff view. The base is what the next
  // poll compares against, so stamping it here is the echo guard.
  private async stampBase(
    record: EntityRecord,
    shape: { title: string; status: string; completedAt: string | null },
  ): Promise<void> {
    const base = record.mirrors.todoist?.base ?? null;
    const id = record.id;
    const view = toDiffViewWithBody(
      new TaskData(
        id,
        record.notePath,
        {}, // bases carry no handles
        shape.title,
        '', // the Todoist description is not vault content
        shape.status,
        shape.completedAt,
        '', // the vault-owned type never rides a Todoist base
        base?.parent ?? null,
        base?.createdAt ?? null,
        base?.updatedAt ?? null,
      ),
    );
    const mirrors = {
      ...record.mirrors,
      todoist: new Mirror(record.mirrors.todoist?.handle ?? '', view),
    };
    await this.syncState.set({ id, notePath: record.notePath, mirrors });
  }
}

// The winning task shape for a completion: the vault's own content with the
// done lane and the observed completion stamp.
function withCompletion(
  current: TaskData,
  doneLane: string,
  completedAt: string,
): TaskData {
  return new TaskData(
    current.id,
    current.notePath,
    current.mirrors,
    current.title,
    current.body,
    doneLane,
    completedAt,
    current.type,
    current.parent,
    current.createdAt,
    current.updatedAt,
  );
}

// The winning task shape for a reopen: the vault's own content pulled back to
// the default lane with the completion stamp cleared.
function withReopen(current: TaskData, defaultLane: string): TaskData {
  return new TaskData(
    current.id,
    current.notePath,
    current.mirrors,
    current.title,
    current.body,
    defaultLane,
    null,
    current.type,
    current.parent,
    current.createdAt,
    current.updatedAt,
  );
}

// Whether the record's todoist base already records the item as completed. A
// completed base is what tells our own close from a remote one.
function baseDone(record: EntityRecord): boolean {
  const base = record.mirrors.todoist?.base ?? null;
  return base !== null && base.completedAt !== null;
}

// A to-do note lives at Projecten/<project>/todos/<file>.md.
function isToDoPath(notePath: string, projectName: string): boolean {
  return notePath.startsWith(`Projecten/${projectName}/todos/`);
}
