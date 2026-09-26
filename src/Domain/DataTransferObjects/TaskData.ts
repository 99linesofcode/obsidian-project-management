// The canonical task: one provider-neutral shape for a GitHub issue, a Todoist
// task and a vault task note. Identity fields link the representations — a side
// leaves the ones it does not know empty — and the content fields are the shape
// the diff compares. Provider transport DTOs (GithubTaskData, TodoistTaskData)
// are mapped onto this at the boundary by the mappers; the core never sees a
// provider shape.
export interface TaskData {
  // Identity — links the representations.
  url: string;
  remoteId: number;
  nodeId: string;
  todoistId: string;
  notePath: string;
  // Content — the comparable shape.
  title: string;
  body: string;
  status: string;
  completed: boolean;
  parent: string | null;
  labels: string[];
  updatedAt: string;
}
