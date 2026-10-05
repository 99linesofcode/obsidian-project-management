import { TaskData } from '../DataTransferObjects/TaskData.js';
import { sameLabels } from '../Labels/sameLabels.js';
import { projectFromNotePath } from '../Notes/projectFromNotePath.js';
import { projectFromTodoPath } from '../Notes/projectFromTodoPath.js';
import { toDiffViewWithBody } from '../Reconciliation/toDiffView.js';
import type { EntityRecord, SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { ToDoData } from '../DataTransferObjects/ToDoData.js';

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
  // The derived label set (dt-09).
  labels: string[];
  // The vault note the task mirrors, for the registry record.
  notePath: string;
  syncedAt: string;
  // The registry record the caller already resolved, when it has one. Falls
  // back to a note-path lookup so the writer stays usable on its own.
  record?: EntityRecord | null;
  // The todoist mirror handle the caller resolved from the registry's port
  // items. The handle is not on the entity in v3, so the caller passes it.
  handle?: string | null;
}

export interface ApplyToDoToTodoistInput {
  // The winning canonical to-do (the vault's: the vault owns to-do structure).
  todo: ToDoData;
  // The live twin, or null when none exists yet.
  current: TodoistTaskData | null;
  projectId: string;
  // The task or parent to-do twin the to-do hangs under.
  parentId: string;
  projectName: string;
  notePath: string;
  syncedAt: string;
  record?: EntityRecord | null;
  // The todoist mirror handle the caller resolved from the registry's port
  // items.
  handle?: string | null;
}

// The label every to-do carries (dt-09); the label set is derived, never
// free-form.
const TODO_LABEL = 'todo';

// The Todoist writer: renders a winning canonical task or to-do onto its twin,
// writing ONLY the fields that differ — the gate IS the diff. Look-up-before-
// create is the contract: the adapter's ensureLabel is idempotent (creating a
// duplicate errors) and the pipeline ensures the lane sections before the
// writer runs. Every write records the registry's todoist mirror after the
// write, so the next poll never reads our own write as a remote change (dt-08).
// The base advance is owned HERE, after the writes resolve: advancing it
// earlier would make the next pass compare the remote against a base that
// already claims the new state (the revert bug).
export class ApplyTaskToTodoistAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly syncState: SyncStatePort,
  ) {}

  // Projects one task and returns its twin id (the pipeline needs it to nest a
  // child under its slice). A settled twin is left untouched.
  async executeTask(input: ApplyTaskToTodoistInput): Promise<string> {
    const record = await this.resolveRecord(input.record, input.notePath);
    const handle =
      input.handle ?? (await this.lookupHandle(record, input.notePath));
    const base = await this.mirrorBase(handle);
    const desired = {
      content: input.task.title,
      labels: input.labels,
      sectionId: input.sectionId,
      parentId: input.parentId,
      isCompleted: input.task.completedAt !== null,
      // The lane is controlled only for a top-level task (a subtask inherits
      // its parent's section, dt-02).
      lane: input.parentId === null ? input.task.status : null,
    };
    const current = input.current;

    if (handle !== null && current && matches(desired, current)) {
      // A settled twin still advances the base: after the fingerprint widened,
      // an old-format digest reads as a change on both sides, and this skip is
      // the repair path that rewrites the base to the current digest without a
      // remote write.
      await this.advanceBase(input, record, handle, desired);
      return handle;
    }

    if (handle === null) {
      await this.ensureLabel(input.labels);
      const created = await this.taskManager.createTask({
        projectId: input.projectId,
        ...(input.sectionId === null ? {} : { sectionId: input.sectionId }),
        ...(input.parentId === null ? {} : { parentId: input.parentId }),
        content: desired.content,
        labels: desired.labels,
      });
      if (desired.isCompleted) {
        await this.taskManager.setTaskCompleted(created.id, true);
      }
      await this.advanceBase(input, record, created.id, desired);
      return created.id;
    }

    const id = handle;
    // A twin missing from the active set is completed (or gone). A completed
    // twin whose base already carries the completion stamp is settled: no
    // re-complete and no base rewrite (dt-17). Without this gate the twin is
    // re-completed and re-stamped on every pass once the completed-since window
    // has aged past its completion. An active vault reopens it.
    if (!current) {
      if (desired.isCompleted && baseDone(base)) {
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
      await this.advanceBase(input, record, id, desired);
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
    await this.advanceBase(input, record, id, desired);
    return id;
  }

  // Projects one to-do and returns its twin id. A settled twin is untouched;
  // only a vault-side completion change moves the twin (a remote change is
  // absorbed by ApplyTodoistCompletionAction before the projection runs).
  async executeToDo(input: ApplyToDoToTodoistInput): Promise<string> {
    const record = await this.resolveRecord(input.record, input.notePath);
    const handle =
      input.handle ?? (await this.lookupHandle(record, input.notePath));
    // A to-do's identity is its note in the project's to-do folder. Anything
    // else — a legacy bare-stem path above all — must never create, stamp or
    // write, or the twin is re-created and re-captured every tick. Refuse and
    // let the projection resolve the real path next tick; the stored id is
    // returned so a caller can still nest a child under an existing twin.
    if (projectFromTodoPath(input.notePath) !== input.projectName) {
      console.error(
        `ApplyTaskToTodoistAction: refusing to project to-do ${input.notePath} outside Projecten/${input.projectName}/todos/`,
      );
      return handle ?? '';
    }

    const desired = {
      content: input.todo.title,
      labels: [TODO_LABEL],
      parentId: input.parentId,
      isCompleted: input.todo.status === 'completed',
    };
    const current = input.current;
    const base = await this.mirrorBase(handle);
    const baseCompleted = baseDone(base);

    if (handle === null) {
      await this.taskManager.ensureLabel(TODO_LABEL);
      const created = await this.taskManager.createTask({
        projectId: input.projectId,
        parentId: input.parentId,
        content: desired.content,
        labels: desired.labels,
      });
      if (desired.isCompleted) {
        await this.taskManager.setTaskCompleted(created.id, true);
      }
      await this.advanceToDoBase(input, record, created.id, desired);
      return created.id;
    }

    const id = handle;
    // The twin is absent from the active set: completed (or gone). A vault-side
    // completion change is pushed; a remote change is left to the completion
    // action.
    if (!current) {
      if (desired.isCompleted !== baseCompleted) {
        await this.taskManager.setTaskCompleted(id, desired.isCompleted);
        await this.advanceToDoBase(input, record, id, desired);
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
      desired.isCompleted !== baseCompleted &&
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
    await this.advanceToDoBase(input, record, id, desired);
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

  // Resolves the entity record for a note: the caller's, else a path lookup.
  private async resolveRecord(
    record: EntityRecord | null | undefined,
    notePath: string,
  ): Promise<EntityRecord | null> {
    return record ?? (await this.syncState.findByNotePath(notePath));
  }

  // The entity's todoist handle, resolved from the registry's port items when
  // the caller did not pass one. The entity no longer carries the handle, so a
  // standalone call still anchors correctly.
  private async lookupHandle(
    record: EntityRecord | null,
    notePath: string,
  ): Promise<string | null> {
    if (record === null) {
      return null;
    }
    for (const { handle, item } of await this.syncState.listMirrorItems(
      projectFromNotePath(notePath),
      'todoist',
    )) {
      if (item.entityId === record.id) {
        return handle;
      }
    }
    return null;
  }

  // Stores what the twin now carries as the todoist mirror's base. WHY the base
  // advances only here, after every write above resolved: a base advanced
  // before the write lands makes the next pass compare the twin against a base
  // that already claims the new state, so the twin's still-stale value reads as
  // a fresh change and reverts the vault (the revert bug).
  private async advanceBase(
    input: ApplyTaskToTodoistInput,
    record: EntityRecord | null,
    handle: string,
    desired: {
      content: string;
      labels: string[];
      sectionId: string | null;
      parentId: string | null;
      isCompleted: boolean;
      lane: string | null;
    },
  ): Promise<void> {
    const parent = await this.parentUuid(desired.parentId);
    await this.writeBase(record, input.notePath, handle, {
      title: desired.content,
      status: desired.lane ?? '',
      completedAt: desired.isCompleted ? (input.task.completedAt ?? '') : null,
      parent,
      createdAt: input.task.createdAt,
      updatedAt: input.task.updatedAt,
    });
  }

  private async advanceToDoBase(
    input: ApplyToDoToTodoistInput,
    record: EntityRecord | null,
    handle: string,
    desired: {
      content: string;
      labels: string[];
      parentId: string;
      isCompleted: boolean;
    },
  ): Promise<void> {
    const parent = await this.parentUuid(desired.parentId);
    await this.writeBase(record, input.notePath, handle, {
      title: desired.content,
      // A to-do is always a subtask: it inherits its parent's section, so its
      // status carries the to-do vocabulary (open/completed), not a lane.
      status: desired.isCompleted ? 'completed' : 'open',
      completedAt: desired.isCompleted ? (input.todo.completedAt ?? '') : null,
      parent,
      createdAt: input.todo.createdAt,
      updatedAt: input.todo.updatedAt,
    });
  }

  // Persists the todoist mirror item, creating the hub entity when the writer
  // is the first to mirror the note (a vault to-do). The base is a DIFF VIEW
  // (body = digest), matching what the next diff reads.
  private async writeBase(
    record: EntityRecord | null,
    notePath: string,
    handle: string,
    shape: {
      title: string;
      status: string;
      completedAt: string | null;
      parent: string | null;
      createdAt: string | null;
      updatedAt: string | null;
    },
  ): Promise<void> {
    const id = record?.id ?? (await this.ensureEntity(notePath));
    if (id === '') {
      return;
    }
    const base = toDiffViewWithBody(
      new TaskData(
        id,
        notePath,
        {}, // bases carry no handles
        shape.title,
        '', // the Todoist description is not vault content
        shape.status,
        shape.completedAt,
        '', // the vault-owned type never rides a Todoist base
        shape.parent,
        shape.createdAt,
        shape.updatedAt,
      ),
    );
    // Skip the write when the stored base already carries this diff view: the
    // no-op skip path advances the base only to repair a stale digest, never to
    // rewrite an unchanged one on every pass.
    const existing = await this.mirrorBase(handle);
    if (existing !== null && existing.canonical() === base.canonical()) {
      return;
    }
    await this.syncState.setMirrorItem(
      projectFromNotePath(notePath),
      'todoist',
      handle,
      { entityId: id, base },
    );
  }

  // The todoist mirror's stored base for a handle, or null when no item exists.
  private async mirrorBase(handle: string | null): Promise<TaskData | null> {
    if (handle === null) {
      return null;
    }
    return (await this.syncState.findMirrorItem('todoist', handle))?.base ?? null;
  }

  // The parent entity's uuid, resolved from the parent twin id through the
  // registry. A top-level item (null parent) has none; an unresolved parent
  // stays null and the next pass retries.
  private async parentUuid(parentId: string | null): Promise<string | null> {
    if (parentId === null) {
      return null;
    }
    return (await this.syncState.findMirrorItem('todoist', parentId))?.entityId ?? null;
  }

  // The vault-owned uuid of a note, minted at record creation when the writer
  // is the first to mirror the note. The registry is the id's home now — the
  // note frontmatter no longer carries one (dt-20) — so an unregistered note
  // gets a fresh entity before its mirror item is written.
  private async ensureEntity(notePath: string): Promise<string> {
    const existing = await this.syncState.findByNotePath(notePath);
    if (existing !== null) {
      return existing.id;
    }
    const id = crypto.randomUUID();
    await this.syncState.setEntity({ id, notePath });
    return id;
  }
}

// Whether the stored todoist base already records the item as completed. A
// completed base is what tells our own close from a remote one (the echo
// guard).
function baseDone(base: TaskData | null): boolean {
  return base !== null && base.completedAt !== null;
}

// Whether the twin already carries the desired shape. A null desired section
// or parent means the field is not controlled here (a subtask inherits its
// section), so it is not compared.
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
