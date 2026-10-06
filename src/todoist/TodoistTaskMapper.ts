import { TaskData } from '../shared/TaskData.js';
import type { TodoistSectionData } from './TodoistSectionData.js';
import type { TodoistTaskData } from './TodoistTaskData.js';
import { typeFromLabels } from '../shared/typeFromLabels.js';

// The Todoist side of the canonical task. A fetched task carries its content,
// labels and completion; its section (a lane) and parent are separate records,
// so they are passed alongside. One-way: parse maps the provider records onto
// TaskData; the writers build their create payloads inline, so there is no
// render half.
export const TodoistTaskMapper = {
  // The remote live view. Identity (id, notePath) is left empty: the half
  // composes it from the registry record, never from the fetch. The parent is
  // the raw twin id; only the registry can turn it into the parent's uuid.
  parseTask(
    task: TodoistTaskData,
    section: TodoistSectionData | null,
    parent: TodoistTaskData | null,
  ): TaskData {
    return new TaskData({
      id: '',
      notePath: '',
      mirrors: { todoist: task.id },
      title: task.content,
      body: '',
      status: section?.name ?? '',
      completedAt: task.isCompleted ? (task.completedAt ?? '') : null,
      type: typeFromLabels(task.labels),
      parent: parent?.id ?? task.parentId,
      createdAt: task.addedAt || null,
      updatedAt: task.updatedAt || null,
    });
  },
};
