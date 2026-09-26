import { sameLabels } from '../Labels/sameLabels.js';
import { stampFrontmatterField } from '../Notes/stampFrontmatterField.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { ToDoData } from '../DataTransferObjects/ToDoData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface ApplyTaskToTodoistInput {
  // The winning canonical task (the vault's on push/conflict).
  task: TaskData;
  // The live twin, or null when none exists yet. The gate IS the diff: every
  // field is compared against this before writing.
  current: TodoistTaskData | null;
  // Placement resolved by the pipeline: the lane's section for a top-level
  // task, the parent twin id for a subtask (a subtask inherits its parent's
  // section, dt-02).
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  // The derived label set (dt-09) and the issue deep link (empty for a draft).
  labels: string[];
  description: string;
  // The vault note the task mirrors, for the anchor and the snapshot record.
  notePath: string;
  noteContent: string;
  syncedAt: string;
}

export interface ApplyToDoToTodoistInput {
  // The winning canonical to-do (the vault's: the vault owns to-do structure).
  todo: ToDoData;
  // The live twin, or null when none exists yet.
  current: TodoistTaskData | null;
  projectId: string;
  // The task or parent to-do twin the to-do hangs under.
  parentId: string;
  notePath: string;
  noteContent: string;
  syncedAt: string;
}

// The label every to-do carries (dt-09); the label set is derived, never
// free-form.
const TODO_LABEL = 'todo';

// The Todoist writer: renders a winning canonical task or to-do onto its twin,
// writing ONLY the fields that differ — the gate IS the diff. Absorbs the write
// paths of ProjectTasksToTodoistAction (create/update/move/complete; slices,
// children, top-level tasks) and ProjectToDosToTodoistAction (roots and nested
// to-dos). Look-up-before-create is the contract: the adapter's ensureLabel is
// idempotent (creating a duplicate errors) and the pipeline ensures the lane
// sections before the writer runs. Every write stamps the note's `todoist`
// anchor on creation and the per-item snapshot record after the write, so the
// next poll never reads our own write as a remote change (dt-08).
export class ApplyTaskToTodoistAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  // Projects one task and returns its twin id (the pipeline needs it to nest a
  // child under its slice). A settled twin is left untouched.
  async executeTask(input: ApplyTaskToTodoistInput): Promise<string> {
    const desired = {
      content: input.task.title,
      labels: input.labels,
      sectionId: input.sectionId,
      parentId: input.parentId,
      isCompleted: input.task.completed,
      // The lane is controlled only for a top-level task (a subtask inherits
      // its parent's section, dt-02).
      lane: input.parentId === null ? input.task.status : null,
    };
    const stored = await this.syncState.getTodoistState(input.notePath);
    const current = input.current;

    if (stored && current && matches(desired, current)) {
      return stored.todoistId;
    }

    if (!stored) {
      await this.ensureLabel(input.labels);
      const created = await this.taskManager.createTask({
        projectId: input.projectId,
        ...(input.sectionId === null ? {} : { sectionId: input.sectionId }),
        ...(input.parentId === null ? {} : { parentId: input.parentId }),
        content: desired.content,
        labels: desired.labels,
        description: input.description,
      });
      await stampFrontmatterField(
        this.vault,
        input.notePath,
        input.noteContent,
        'todoist',
        created.id,
      );
      if (desired.isCompleted) {
        await this.taskManager.setTaskCompleted(created.id, true);
      }
      await this.stampTask(input.notePath, created.id, desired);
      return created.id;
    }

    const id = stored.todoistId;
    // A twin missing from the active set is completed (or gone). A completed
    // twin whose snapshot already carries the completion stamp is settled: no
    // re-complete and no snapshot rewrite (dt-17). Without this gate the twin
    // is re-completed and re-stamped on every pass once the completed-since
    // window has aged past its completion. An active vault reopens it.
    if (!current) {
      if (desired.isCompleted && stored.completed) {
        return id;
      }
      if (!desired.isCompleted) {
        await this.taskManager.setTaskCompleted(id, false);
        // A reopened task must leave the done section too: a task's section IS
        // its lane, so a twin reopened in place would still read as done to the
        // absorber, which would drag the note back into done on the next tick.
        // The section is controlled only for a top-level task (a subtask
        // inherits its parent's section, dt-02). Reopening first puts the twin
        // back in the active set the move targets.
        if (desired.sectionId !== null) {
          await this.taskManager.moveTask(id, { sectionId: desired.sectionId });
        }
      }
      await this.stampTask(input.notePath, id, desired);
      return id;
    }

    if (
      current.content !== desired.content ||
      !sameLabels(current.labels, desired.labels)
    ) {
      await this.ensureLabel(input.labels);
      await this.taskManager.updateTask(id, {
        content: desired.content,
        labels: desired.labels,
      });
    }
    if (desired.sectionId !== null && current.sectionId !== desired.sectionId) {
      await this.taskManager.moveTask(id, { sectionId: desired.sectionId });
    }
    if (desired.parentId !== null && current.parentId !== desired.parentId) {
      await this.taskManager.moveTask(id, { parentId: desired.parentId });
    }
    if (desired.isCompleted) {
      await this.taskManager.setTaskCompleted(id, true);
    }
    await this.stampTask(input.notePath, id, desired);
    return id;
  }

  // Projects one to-do and returns its twin id. A settled twin is untouched;
  // only a vault-side completion change moves the twin (a remote change is
  // absorbed by ApplyTodoistCompletionAction before the projection runs).
  async executeToDo(input: ApplyToDoToTodoistInput): Promise<string> {
    const desired = {
      content: input.todo.title,
      labels: [TODO_LABEL],
      parentId: input.parentId,
      isCompleted: input.todo.status === 'completed',
    };
    const stored = await this.syncState.getTodoistState(input.notePath);
    const current = input.current;
    const storedCompleted = stored?.completed ?? false;

    if (!stored) {
      await this.taskManager.ensureLabel(TODO_LABEL);
      const created = await this.taskManager.createTask({
        projectId: input.projectId,
        parentId: input.parentId,
        content: desired.content,
        labels: desired.labels,
      });
      await stampFrontmatterField(
        this.vault,
        input.notePath,
        input.noteContent,
        'todoist',
        created.id,
      );
      if (desired.isCompleted) {
        await this.taskManager.setTaskCompleted(created.id, true);
      }
      await this.stampToDo(input.notePath, created.id, desired);
      return created.id;
    }

    const id = stored.todoistId;
    // The twin is absent from the active set: completed (or gone). A vault-side
    // completion change is pushed; a remote change is left to the completion
    // action.
    if (!current) {
      if (desired.isCompleted !== storedCompleted) {
        await this.taskManager.setTaskCompleted(id, desired.isCompleted);
        await this.stampToDo(input.notePath, id, desired);
      }
      return id;
    }

    const contentDrift =
      current.content !== desired.content ||
      !sameLabels(current.labels, desired.labels);
    const parentDrift = current.parentId !== desired.parentId;
    // Only a vault-side completion change moves the twin; a twin that already
    // matches the vault (a remote reopen the apply action resolved) does not.
    const completionDrift =
      desired.isCompleted !== storedCompleted &&
      current.isCompleted !== desired.isCompleted;

    if (!contentDrift && !parentDrift && !completionDrift) {
      return id;
    }

    if (contentDrift) {
      await this.taskManager.ensureLabel(TODO_LABEL);
      await this.taskManager.updateTask(id, {
        content: desired.content,
        labels: desired.labels,
      });
    }
    if (parentDrift) {
      await this.taskManager.moveTask(id, { parentId: desired.parentId });
    }
    if (completionDrift) {
      await this.taskManager.setTaskCompleted(id, desired.isCompleted);
    }
    await this.stampToDo(input.notePath, id, desired);
    return id;
  }

  // Ensures the derived label exists before a create or a label drift write.
  // The adapter's ensureLabel is idempotent by contract (creating a duplicate
  // errors on Todoist), so this is the look-up-before-create gate (dt-12).
  private async ensureLabel(labels: string[]): Promise<void> {
    for (const label of labels) {
      await this.taskManager.ensureLabel(label);
    }
  }

  private async stampTask(
    notePath: string,
    todoistId: string,
    desired: {
      content: string;
      labels: string[];
      sectionId: string | null;
      parentId: string | null;
      isCompleted: boolean;
      lane: string | null;
    },
  ): Promise<void> {
    await this.syncState.setTodoistState(notePath, {
      url: '',
      remoteId: 0,
      nodeId: '',
      todoistId,
      notePath,
      title: desired.content,
      body: '',
      status: desired.lane ?? '',
      completed: desired.isCompleted,
      parent: desired.parentId,
      labels: [...desired.labels],
      updatedAt: '',
    });
  }

  private async stampToDo(
    notePath: string,
    todoistId: string,
    desired: {
      content: string;
      labels: string[];
      parentId: string;
      isCompleted: boolean;
    },
  ): Promise<void> {
    await this.syncState.setTodoistState(notePath, {
      url: '',
      remoteId: 0,
      nodeId: '',
      todoistId,
      notePath,
      title: desired.content,
      body: '',
      // A to-do is always a subtask: it inherits its parent's section, so the
      // lane is not a controlled field for it (dt-02).
      status: '',
      completed: desired.isCompleted,
      parent: desired.parentId,
      labels: [...desired.labels],
      updatedAt: '',
    });
  }
}

// Whether the live twin already carries the desired shape. A null desired
// section or parent means the field is not controlled here (a subtask inherits
// its section), so it is not compared.
function matches(
  desired: {
    content: string;
    labels: string[];
    sectionId: string | null;
    parentId: string | null;
    isCompleted: boolean;
  },
  current: TodoistTaskData,
): boolean {
  if (current.content !== desired.content) {
    return false;
  }
  if (!sameLabels(current.labels, desired.labels)) {
    return false;
  }
  if (desired.sectionId !== null && current.sectionId !== desired.sectionId) {
    return false;
  }
  if (desired.parentId !== null && current.parentId !== desired.parentId) {
    return false;
  }
  return current.isCompleted === desired.isCompleted;
}
