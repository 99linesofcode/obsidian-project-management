// A vault-only to-do checklist item: personal, with no GitHub issue and no
// board card. The boundary payload for the later to-do lifecycle action.
export interface ToDoData {
  title: string;
  projectName: string;
  taskLink: string;
  parentTodoLink?: string;
  status: 'open' | 'completed';
  completedAt?: string;
}
