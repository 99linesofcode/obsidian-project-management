import { TaskData } from '../DataTransferObjects/TaskData.js';
import { ToDoData } from '../DataTransferObjects/ToDoData.js';
import type { CreateTodoistTaskData } from '../DataTransferObjects/CreateTodoistTaskData.js';
import type { TodoistSectionData } from '../DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';

// The label the to-do projection puts on a to-do twin. It is a structural
// marker, not a vault-owned type, so parseTask never reports it as the type.
const TODO_LABEL = 'todo';

// The Todoist side of the canonical task and to-do. A fetched task carries its
// content, labels and completion; its section (a lane) and parent are separate
// records, so they are passed alongside. Two-way: parse maps the provider
// records onto TaskData / ToDoData, render maps them back onto the create
// payload. Placement (project, section, parent) is supplied by the caller.
export const TodoistTaskMapper = {
  // The remote live view. Identity (id, notePath) is left empty: the half
  // composes it from the registry record, never from the fetch. The parent is
  // the raw twin id; only the registry can turn it into the parent's uuid.
  parseTask(
    task: TodoistTaskData,
    section: TodoistSectionData | null,
    parent: TodoistTaskData | null,
  ): TaskData {
    return new TaskData(
      '', // identity is composed by the half from the registry record
      '', // notePath is composed by the half from the registry record
      { todoist: task.id }, // the live-view mirror handle
      task.content,
      // The description is not vault content (it carries the issue link); the
      // half owns the body and never diffs it for Todoist.
      '',
      section?.name ?? '',
      // The completion invariant: done <=> completedAt !== null. Todoist's own
      // completedAt is the honest stamp; '' marks "done, stamp unknown" when
      // the provider omitted it.
      task.isCompleted ? (task.completedAt ?? '') : null,
      // The label is the mirror's REPRESENTATION of the vault-owned type; the
      // half reads it back but never lets it drive a type pull.
      typeFromLabels(task.labels),
      parent?.id ?? task.parentId,
      task.addedAt || null,
      task.updatedAt || null,
    );
  },

  parseToDo(task: TodoistTaskData, _parent: TodoistTaskData | null): ToDoData {
    return new ToDoData(
      '',
      '',
      { todoist: task.id },
      task.content,
      task.isCompleted ? 'completed' : 'open',
      task.isCompleted ? (task.completedAt ?? '') : null,
      // WHY null: parentTodo and task are uuids; resolving them needs the
      // registry. The action layer resolves them and leaves null until it can.
      null,
      null,
      task.addedAt || null,
      task.updatedAt || null,
    );
  },

  renderTask(
    task: TaskData,
    projectId: string,
    sectionId: string | null,
  ): CreateTodoistTaskData {
    return {
      projectId,
      content: task.title,
      labels: task.type === '' ? [] : [task.type],
      ...(sectionId === null ? {} : { sectionId }),
      ...(task.parent === null ? {} : { parentId: task.parent }),
    };
  },

  renderToDo(
    todo: ToDoData,
    projectId: string,
    parentId: string,
  ): CreateTodoistTaskData {
    return {
      projectId,
      parentId,
      content: todo.title,
      labels: [TODO_LABEL],
    };
  },
};

// The vault-owned content type carried by a task twin's label, or '' when it
// carries none. The to-do marker is not a type, so it is filtered out.
export function typeFromLabels(labels: string[]): string {
  return labels.find((label) => label !== TODO_LABEL) ?? '';
}
