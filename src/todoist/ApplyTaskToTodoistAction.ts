import { TaskData } from '../shared/TaskData.js';
import { hasCompletionStamp } from '../shared/hasCompletionStamp.js';
import { sameLabels } from '../shared/sameLabels.js';
import { projectFromNotePath } from '../projects/projectFromNotePath.js';
import { projectFromTodoPath } from '../todos/projectFromTodoPath.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import { TODO_LABEL } from '../shared/labels.js';
import { ensureEntity } from '../registry/ensureEntity.js';
import { parentUuid } from '../registry/parentUuid.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskManagerPort } from '../shared/TaskManagerPort.js';
import type { TodoistTaskData } from './TodoistTaskData.js';
import type { ToDoData } from '../shared/ToDoData.js';

export interface ApplyTaskToTodoistInput {
  task: TaskData;
  current: TodoistTaskData | null;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  labels: string[];
  notePath: string;
  connectionSlug: string;
  syncedAt: string;
  record?: EntityRecord | null;
  handle?: string | null;
}

export interface ApplyToDoToTodoistInput {
  todo: ToDoData;
  current: TodoistTaskData | null;
  projectId: string;
  parentId: string | null;
  sectionId?: string | null;
  projectName: string;
  notePath: string;
  connectionSlug: string;
  syncedAt: string;
  record?: EntityRecord | null;
  handle?: string | null;
}

export class ApplyTaskToTodoistAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async executeTask(input: ApplyTaskToTodoistInput): Promise<string> {
    const record = await this.resolveRecord(input.record, input.notePath);
    const handle =
      input.handle ?? (await this.lookupHandle(input.connectionSlug, record));
    const base = await this.mirrorBase(input.connectionSlug, handle);
    const desired = {
      content: input.task.title,
      labels: input.labels,
      sectionId: input.sectionId,
      parentId: input.parentId,
      isCompleted: input.task.completedAt !== null,
      lane: input.parentId === null ? input.task.status : null,
    };
    const current = input.current;

    if (handle !== null && current && matches(desired, current)) {
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
    if (!current) {
      if (desired.isCompleted && hasCompletionStamp(base)) {
        return id;
      }
      if (!desired.isCompleted) {
        await this.taskManager.setTaskCompleted(id, false);
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

  async executeToDo(input: ApplyToDoToTodoistInput): Promise<string> {
    const record = await this.resolveRecord(input.record, input.notePath);
    const handle =
      input.handle ?? (await this.lookupHandle(input.connectionSlug, record));
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
      sectionId: input.parentId === null ? (input.sectionId ?? null) : null,
      isCompleted: input.todo.status === 'completed',
    };
    const current = input.current;
    const base = await this.mirrorBase(input.connectionSlug, handle);
    const baseCompleted = hasCompletionStamp(base);

    if (handle === null) {
      await this.taskManager.ensureLabel(TODO_LABEL);
      const created = await this.taskManager.createTask({
        projectId: input.projectId,
        ...(desired.sectionId === null ? {} : { sectionId: desired.sectionId }),
        ...(desired.parentId === null ? {} : { parentId: desired.parentId }),
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
    const sectionDrift =
      desired.sectionId !== null && current.sectionId !== desired.sectionId;
    const completionDrift =
      desired.isCompleted !== baseCompleted &&
      current.isCompleted !== desired.isCompleted;

    if (!contentDrift && !parentDrift && !sectionDrift && !completionDrift) {
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
      if (desired.parentId === null) {
        await this.taskManager.moveTask(
          id,
          desired.sectionId === null
            ? { parentId: null }
            : { sectionId: desired.sectionId, parentId: null },
        );
      } else {
        await this.taskManager.moveTask(id, { parentId: desired.parentId });
      }
    } else if (sectionDrift && desired.sectionId !== null) {
      await this.taskManager.moveTask(id, { sectionId: desired.sectionId });
    }
    if (completionDrift) {
      await this.taskManager.setTaskCompleted(id, desired.isCompleted);
    }
    await this.advanceToDoBase(input, record, id, desired);
    return id;
  }

  private async ensureLabel(labels: string[]): Promise<void> {
    for (const label of labels) {
      await this.taskManager.ensureLabel(label);
    }
  }

  private async resolveRecord(
    record: EntityRecord | null | undefined,
    notePath: string,
  ): Promise<EntityRecord | null> {
    return record ?? (await this.syncState.findByNotePath(notePath));
  }

  private async lookupHandle(
    connectionSlug: string,
    record: EntityRecord | null,
  ): Promise<string | null> {
    if (record === null) {
      return null;
    }
    return (
      (await this.syncState.findMirrorItemByEntity(connectionSlug, record.id))
        ?.handle ?? null
    );
  }

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
    const parent = await parentUuid(
      this.syncState,
      input.connectionSlug,
      desired.parentId,
    );
    await this.writeBase(input.connectionSlug, record, input.notePath, handle, {
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
      parentId: string | null;
      sectionId: string | null;
      isCompleted: boolean;
    },
  ): Promise<void> {
    const parent = await parentUuid(
      this.syncState,
      input.connectionSlug,
      desired.parentId,
    );
    await this.writeBase(input.connectionSlug, record, input.notePath, handle, {
      title: desired.content,
      status: desired.isCompleted ? 'completed' : 'open',
      completedAt: desired.isCompleted ? (input.todo.completedAt ?? '') : null,
      parent,
      createdAt: input.todo.createdAt,
      updatedAt: input.todo.updatedAt,
    });
  }

  private async writeBase(
    connectionSlug: string,
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
    const id = record?.id ?? (await ensureEntity(this.syncState, notePath));
    if (id === '') {
      return;
    }
    const base = toDiffViewWithBody(
      new TaskData({
        id: id,
        notePath: notePath,
        mirrors: {},
        title: shape.title,
        body: '',
        status: shape.status,
        completedAt: shape.completedAt,
        type: '',
        parent: shape.parent,
        createdAt: shape.createdAt,
        updatedAt: shape.updatedAt,
      }),
    );
    const existing = await this.mirrorBase(connectionSlug, handle);
    if (existing !== null && existing.canonical() === base.canonical()) {
      return;
    }
    await this.syncState.setMirrorItem(
      projectFromNotePath(notePath),
      connectionSlug,
      handle,
      { entityId: id, base },
    );
  }

  private async mirrorBase(
    connectionSlug: string,
    handle: string | null,
  ): Promise<TaskData | null> {
    if (handle === null) {
      return null;
    }
    return (
      (await this.syncState.findMirrorItem(connectionSlug, handle))?.base ??
      null
    );
  }
}

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
