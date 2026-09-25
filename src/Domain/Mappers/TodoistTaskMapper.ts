import type { CreateTodoistTaskData } from '../DataTransferObjects/CreateTodoistTaskData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { ToDoData } from '../DataTransferObjects/ToDoData.js';
import type { TodoistSectionData } from '../DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';

// The Todoist side of the canonical task and to-do. A fetched task carries its
// content, labels and completion; its section (a lane) and parent are separate
// records, so they are passed alongside. Two-way: parse maps the provider
// records onto TaskData / ToDoData, render maps them back onto the create
// payload. Placement (project, section, parent) is supplied by the caller.
export const TodoistTaskMapper = {
  parseTask(
    task: TodoistTaskData,
    section: TodoistSectionData | null,
    parent: TodoistTaskData | null,
  ): TaskData {
    return {
      url: task.url,
      remoteId: 0,
      nodeId: '',
      todoistId: task.id,
      notePath: '',
      title: task.content,
      body: '',
      status: section?.name ?? '',
      completed: task.isCompleted,
      parent: parent?.id ?? task.parentId,
      labels: [...task.labels],
      updatedAt: '',
    };
  },

  parseToDo(task: TodoistTaskData, parent: TodoistTaskData | null): ToDoData {
    return {
      todoistId: task.id,
      notePath: '',
      projectName: '',
      taskLink: parent?.id ?? task.parentId ?? '',
      parentTodoLink: null,
      title: task.content,
      status: task.isCompleted ? 'completed' : 'open',
    };
  },

  renderTask(
    task: TaskData,
    projectId: string,
    sectionId: string | null,
  ): CreateTodoistTaskData {
    return {
      projectId,
      content: task.title,
      labels: [...task.labels],
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
      labels: ['todo'],
    };
  },
};