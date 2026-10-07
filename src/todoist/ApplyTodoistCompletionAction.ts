import { TaskData } from '../shared/TaskData.js';
import { hasCompletionStamp } from '../shared/Reconciliation.js';
import type { TodoistTaskSnapshotData } from './TodoistTaskSnapshotData.js';
import { ToDoNoteParser, withToDoStatus } from '../vault/ToDoNoteParser.js';
import { VaultTaskMapper } from '../vault/VaultTaskMapper.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import type { TodoistTaskData } from './TodoistTaskData.js';
import { todoistEntries } from '../registry/todoistEntries.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';
import type { ApplyTaskToVaultAction } from '../tasks/ApplyTaskToVaultAction.js';

export interface ApplyTodoistCompletionInput {
  projectName: string;
  // The connection whose mirror this pass advances.
  connectionSlug: string;
  // The project's code-host connection slug, when it has one, so the lane
  // vocabulary resolves from that connection's identity.
  githubConnectionSlug: string | null;
  syncedAt: string;
  // The pass's shared Todoist snapshot. The half fetched the active and
  // completed sets once; this absorber never lists the project itself.
  snapshot: TodoistTaskSnapshotData;
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
// after a successful pass; the pass's snapshot was fetched upstream, so a
// failed fetch means this action never runs and the window retries next tick.
export class ApplyTodoistCompletionAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly applyToVault: ApplyTaskToVaultAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: ApplyTodoistCompletionInput): Promise<void> {
    const portState = await this.syncState.getPortState(
      input.projectName,
      input.connectionSlug,
    );

    // The pass's snapshot was fetched upstream, before any vault write or
    // cursor move.
    const { completed, active } = input.snapshot;
    const activeById = new Map(active.map((task) => [task.id, task]));

    // The project's todoist items, joined to their hub entities: an item's
    // entityId is the hub reference now that the entity no longer carries the
    // handle.
    const entries = await todoistEntries(
      this.syncState,
      input.connectionSlug,
      input.projectName,
    );
    const byHandle = new Map<
      string,
      { record: EntityRecord; base: TaskData | null }
    >();
    for (const entry of entries) {
      byHandle.set(entry.handle, { record: entry.record, base: entry.base });
    }

    for (const task of completed) {
      const entry = byHandle.get(task.id);
      if (!entry) {
        continue;
      }
      // Our own close: the base already says completed, so this entry is the
      // echo of a vault-driven completion, not a remote change.
      if (hasCompletionStamp(entry.base)) {
        continue;
      }
      await this.applyCompletion(
        entry.record,
        task.id,
        entry.base,
        task,
        input,
      );
    }

    for (const [handle, entry] of byHandle) {
      const twin = activeById.get(handle);
      // Not in the active set: still completed (or gone), no reopen to apply.
      if (!twin) {
        continue;
      }
      // The base said open, so an active twin is no change at all.
      if (!hasCompletionStamp(entry.base)) {
        continue;
      }
      await this.applyReopen(entry.record, handle, entry.base, twin, input);
    }

    await this.syncState.setPortState(input.projectName, input.connectionSlug, {
      provider: 'todoist',
      project: portState?.project ?? '',
      lastPoll: input.syncedAt,
      lanes: portState?.lanes ?? {},
    });
  }

  // Completes a note the remote closed, then stamps the twin's base. A note
  // already completed is left alone (only the base moves). A task twin routes
  // through the vault writer so the done lane and the dt-13 cascade both fire.
  private async applyCompletion(
    record: EntityRecord,
    handle: string,
    base: TaskData | null,
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
      await this.stampBase(
        record,
        handle,
        base,
        input.projectName,
        input.connectionSlug,
        {
          title: task.content,
          status: 'completed',
          completedAt: stamp,
        },
      );
      return;
    }

    const current = VaultTaskMapper.parseTask(note.content, record.notePath, {
      projectName: input.projectName,
      doneLane: this.doneOptionName,
    });
    if (!current) {
      return;
    }
    if (
      current.completedAt === null &&
      current.status !== this.doneOptionName
    ) {
      await this.applyToVault.execute({
        task: withCompletion(current, this.doneOptionName, stamp),
        current,
        projectName: input.projectName,
        connectionSlug: input.connectionSlug,
        syncedAt: input.syncedAt,
        // A push leaves the github base to the GitHub writer: this completion
        // is a Todoist fact, not a GitHub one, so the issue's base must not
        // advance to the vault's new state.
        origin: 'push',
        record,
      });
    }
    await this.stampBase(
      record,
      handle,
      base,
      input.projectName,
      input.connectionSlug,
      {
        title: current.title,
        status: this.doneOptionName,
        completedAt: stamp,
      },
    );
  }

  // Reopens a note the remote reopened, clearing the completion stamp, then
  // stamps the twin's base. A note already open is left alone. Task twins route
  // through the vault writer; the cascade's reopen is asymmetric, so a task's
  // to-dos stay completed.
  private async applyReopen(
    record: EntityRecord,
    handle: string,
    base: TaskData | null,
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
      await this.stampBase(
        record,
        handle,
        base,
        input.projectName,
        input.connectionSlug,
        {
          title: twin.content,
          status: 'open',
          completedAt: null,
        },
      );
      return;
    }

    const current = VaultTaskMapper.parseTask(note.content, record.notePath, {
      projectName: input.projectName,
      doneLane: this.doneOptionName,
    });
    if (!current) {
      return;
    }
    const identity =
      input.githubConnectionSlug === null
        ? null
        : await this.syncState.getIdentity(
            input.projectName,
            input.githubConnectionSlug,
          );
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
        connectionSlug: input.connectionSlug,
        syncedAt: input.syncedAt,
        origin: 'push',
        record,
      });
    }
    await this.stampBase(
      record,
      handle,
      base,
      input.projectName,
      input.connectionSlug,
      {
        title: current.title,
        status: defaultLane,
        completedAt: null,
      },
    );
  }

  // Writes the todoist mirror item's base as a diff view. The base is what the
  // next poll compares against, so stamping it here is the echo guard.
  private async stampBase(
    record: EntityRecord,
    handle: string,
    base: TaskData | null,
    projectName: string,
    connectionSlug: string,
    shape: { title: string; status: string; completedAt: string | null },
  ): Promise<void> {
    const id = record.id;
    const view = toDiffViewWithBody(
      new TaskData({
        id: id,
        notePath: record.notePath,
        mirrors: {},
        title: shape.title,
        body: '',
        status: shape.status,
        completedAt: shape.completedAt,
        type: '',
        parent: base?.parent ?? null,
        createdAt: base?.createdAt ?? null,
        updatedAt: base?.updatedAt ?? null,
      }),
    );
    await this.syncState.setMirrorItem(projectName, connectionSlug, handle, {
      entityId: id,
      base: view,
    });
  }
}

// The winning task shape for a completion: the vault's own content with the
// done lane and the observed completion stamp.
function withCompletion(
  current: TaskData,
  doneLane: string,
  completedAt: string,
): TaskData {
  return new TaskData({
    id: current.id,
    notePath: current.notePath,
    mirrors: current.mirrors,
    title: current.title,
    body: current.body,
    status: doneLane,
    completedAt: completedAt,
    type: current.type,
    parent: current.parent,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  });
}

// The winning task shape for a reopen: the vault's own content pulled back to
// the default lane with the completion stamp cleared.
function withReopen(current: TaskData, defaultLane: string): TaskData {
  return new TaskData({
    id: current.id,
    notePath: current.notePath,
    mirrors: current.mirrors,
    title: current.title,
    body: current.body,
    status: defaultLane,
    completedAt: null,
    type: current.type,
    parent: current.parent,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  });
}

// A to-do note lives at Projecten/<project>/todos/<file>.md.
function isToDoPath(notePath: string, projectName: string): boolean {
  return notePath.startsWith(`Projecten/${projectName}/todos/`);
}
