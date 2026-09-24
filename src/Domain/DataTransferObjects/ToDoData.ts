// A vault-only to-do checklist item: personal, with no GitHub issue and no
// board card. The boundary payload for the later to-do lifecycle action.
export interface ToDoData {
  title: string;
  projectName: string;
  taskLink: string;
  parentTodoLink?: string;
  status: 'open' | 'completed';
  // A full ISO datetime stamp — the sync timestamp of the completion, e.g.
  // 2026-09-18T12:00:00Z. Passed through verbatim; never date-only.
  completedAt?: string;
}
