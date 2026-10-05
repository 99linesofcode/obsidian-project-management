// A Todoist task as fetched from the provider, in the shape the core needs.
// The core never sees raw Todoist JSON. The snapshot hash (dt-08) is computed
// over content, labels, section, parent and isCompleted, so all five are
// carried here. sectionId and parentId are null for a top-level task; a
// subtask inherits its parent's section (dt-02), so its sectionId is the
// parent's, not its own.
//
// addedAt/updatedAt/completedAt are the provider clocks. updatedAt is the
// trustworthy task-scoped content clock the conflict ladder may use; completedAt
// is the completion stamp (present on a completed task). All three are empty
// strings when the provider omits them, and completedAt is null on an open task.
export interface TodoistTaskData {
  id: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  content: string;
  labels: string[];
  isCompleted: boolean;
  addedAt: string;
  updatedAt: string;
  completedAt: string | null;
}
