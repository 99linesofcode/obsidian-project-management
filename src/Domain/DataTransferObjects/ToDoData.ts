// The canonical to-do: a vault-only checklist item with no GitHub issue and no
// board card, mirrored as a Todoist subtask. Identity fields link the vault
// note and its Todoist twin; the content fields are the comparable shape.
export interface ToDoData {
  // Identity — links the representations.
  todoistId: string;
  notePath: string;
  projectName: string;
  taskLink: string;
  parentTodoLink: string | null;
  // Content — the comparable shape.
  title: string;
  status: 'open' | 'completed';
  // A full ISO datetime stamp — the sync timestamp of the completion, e.g.
  // 2026-09-18T12:00:00Z. Passed through verbatim; never date-only.
  completedAt?: string;
}
