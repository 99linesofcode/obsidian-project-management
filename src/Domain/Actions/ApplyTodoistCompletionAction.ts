import { hash } from '../Notes/hash.js';
import { ToDoNoteParser, withToDoStatus } from '../Notes/ToDoNoteParser.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface ApplyTodoistCompletionInput {
  projectName: string;
  projectId: string;
  syncedAt: string;
}

// UC: pull remote completion changes into the vault (t4). A completion is
// caught by the completed-since query from the project's stored cursor; a
// reopen is caught by a to-do twin reappearing in the active set while its
// snapshot says completed (lastSyncedCompleted) — that is what tells a remote
// reopen from a vault-side completion, which ProjectToDosToTodoistAction owns.
//
// The applied completion stamp is the tick's syncedAt — the moment the sync
// observed the change — a full ISO datetime, never date-only. Every applied
// change (and every echo we skip) stamps the item's snapshot so the next poll
// does not read our own write as a remote change. The cursor advances only
// after a successful pass: if either fetch throws, the window is retried next
// tick rather than skipped.
export class ApplyTodoistCompletionAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
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

    // Only this project's to-do notes carry a completion to pull; task twins
    // (t3) are t5's concern.
    const states = (await this.syncState.listTodoistStates()).filter((state) =>
      isToDoPathForProject(state.notePath, input.projectName),
    );
    const stateById = new Map(states.map((state) => [state.todoistId, state]));

    for (const task of completed) {
      const state = stateById.get(task.id);
      if (!state) {
        continue;
      }
      // Our own close: the snapshot already says completed, so this entry is
      // the echo of a vault-driven completion, not a remote change.
      if (state.lastSyncedCompleted) {
        continue;
      }
      await this.applyCompletion(state.notePath, task, input.syncedAt);
    }

    for (const state of states) {
      const twin = activeById.get(state.todoistId);
      // Not in the active set: still completed (or gone), no reopen to apply.
      if (!twin) {
        continue;
      }
      // The snapshot said open, so an active twin is no change at all.
      if (!state.lastSyncedCompleted) {
        continue;
      }
      await this.applyReopen(state.notePath, twin);
    }

    await this.syncState.setTodoistProjectState(input.projectName, {
      sections: projectState?.sections ?? {},
      lastCompletedPoll: input.syncedAt,
    });
  }

  // Completes a to-do note the remote closed, then stamps the twin's completed
  // shape. A note already completed is left alone (only the snapshot moves).
  private async applyCompletion(
    notePath: string,
    task: TodoistTaskData,
    syncedAt: string,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(notePath);
    if (!note) {
      return;
    }
    const parsed = ToDoNoteParser.parse(note.content);
    if (!parsed) {
      return;
    }
    if (parsed.status !== 'completed') {
      await this.vault.writeNote(
        notePath,
        withToDoStatus(note.content, 'completed', syncedAt),
      );
    }
    await this.stampState(notePath, task);
  }

  // Reopens a to-do note the remote reopened, clearing the completion stamp,
  // then stamps the twin's active shape. A note already open is left alone.
  private async applyReopen(
    notePath: string,
    twin: TodoistTaskData,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(notePath);
    if (!note) {
      return;
    }
    const parsed = ToDoNoteParser.parse(note.content);
    if (!parsed) {
      return;
    }
    if (parsed.status === 'completed') {
      await this.vault.writeNote(
        notePath,
        withToDoStatus(note.content, 'open', null),
      );
    }
    await this.stampState(notePath, twin);
  }

  private async stampState(
    notePath: string,
    task: TodoistTaskData,
  ): Promise<void> {
    await this.syncState.setTodoistState(notePath, {
      todoistId: task.id,
      notePath,
      lastSyncedHash: snapshotHash(task),
      lastSyncedCompleted: task.isCompleted,
    });
  }
}

// The snapshot hash (dt-08) over a fetched twin: content, labels, parent and
// completion. The section stays empty — a subtask inherits its parent's
// (dt-02), so it is not a controlled field.
function snapshotHash(task: TodoistTaskData): string {
  return hash(
    [
      task.content,
      [...task.labels].sort().join(','),
      '',
      task.parentId ?? '',
      task.isCompleted ? '1' : '0',
    ].join('\n'),
  );
}

// A to-do note lives at Projecten/<project>/todos/<file>.md.
function isToDoPathForProject(notePath: string, projectName: string): boolean {
  return notePath.startsWith(`Projecten/${projectName}/todos/`);
}
