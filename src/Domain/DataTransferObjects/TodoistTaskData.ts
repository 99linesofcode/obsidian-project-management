// A Todoist task as fetched from the provider, in the shape the core needs.
// The core never sees raw Todoist JSON. The snapshot hash (dt-08) is computed
// over content, labels, section, parent and isCompleted, so all five are
// carried here. sectionId and parentId are null for a top-level task; a
// subtask inherits its parent's section (dt-02), so its sectionId is the
// parent's, not its own.
export interface TodoistTaskData {
  id: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  content: string;
  labels: string[];
  isCompleted: boolean;
  url: string;
}
