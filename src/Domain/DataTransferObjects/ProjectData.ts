// The canonical project: one provider-neutral shape for a GitHub project and a
// Todoist project. Identity fields link the representations; the content fields
// are the comparable shape.
export interface ProjectData {
  // Identity — links the representations.
  githubUrl: string;
  todoistId: string;
  // Content — the comparable shape.
  name: string;
  archived: boolean;
}
