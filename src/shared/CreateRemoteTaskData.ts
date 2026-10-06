// The input the core hands the port to create a task-manager task. sectionId
// and parentId are mutually exclusive in practice: a subtask inherits its
// parent's section (dt-02), so a nested task is placed by parentId alone.
// labels are derived from the note's type (dt-09), never free-form.
export interface CreateRemoteTaskData {
  projectId: string;
  sectionId?: string;
  parentId?: string;
  content: string;
  labels?: string[];
}
