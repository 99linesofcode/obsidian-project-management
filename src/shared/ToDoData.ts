import { DataTransferObject } from './DataTransferObject.js';

// The canonical to-do: a vault-only checklist item with no code-host issue and no
// board card, mirrored as a task-manager subtask. The parent to-do and owning task
// are uuid references; the content fields are the shape the diff compares.
export class ToDoData extends DataTransferObject {
  id: string;
  notePath: string;
  mirrors: Record<string, string>;
  title: string;
  status: 'open' | 'completed';
  completedAt: string | null;
  parentTodo: string | null; // parent to-do's uuid
  task: string | null; // owning task's uuid
  createdAt: string | null;
  updatedAt: string | null;

  constructor(
    id: string,
    notePath: string,
    mirrors: Record<string, string>,
    title: string,
    status: 'open' | 'completed',
    completedAt: string | null,
    parentTodo: string | null,
    task: string | null,
    createdAt: string | null,
    updatedAt: string | null,
  ) {
    super();
    this.id = id;
    this.notePath = notePath;
    this.mirrors = mirrors;
    this.title = title;
    this.status = status;
    this.completedAt = completedAt;
    this.parentTodo = parentTodo;
    this.task = task;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  // Called on DIFF VIEWS only. Identity and provenance are excluded.
  override canonical(): string {
    return [
      this.title,
      this.status,
      this.completedAt ?? '',
      this.parentTodo ?? '',
      this.task ?? '',
    ].join('\u0000');
  }
}
