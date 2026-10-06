import { TaskData } from './TaskData.js';
import { hash } from './hash.js';

// The comparable form of a canonical task: the body rendered to its
// provider-comparable form and replaced by its digest. ALL diffing and base
// storage operates on diff views; live views carry real bodies. Pure.
export function toDiffView(task: TaskData, comparableBody: string): TaskData {
  return rebuild(task, hash(comparableBody));
}

// For callers without a rendering step: the body is digested as it stands.
export function toDiffViewWithBody(task: TaskData): TaskData {
  return toDiffView(task, task.body);
}

// Copies every field of the task, replacing only the body, so a diff view and
// its live view stay comparable on everything else.
function rebuild(task: TaskData, body: string): TaskData {
  return new TaskData({
    id: task.id,
    notePath: task.notePath,
    mirrors: task.mirrors,
    title: task.title,
    body: body,
    status: task.status,
    completedAt: task.completedAt,
    type: task.type,
    parent: task.parent,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}
