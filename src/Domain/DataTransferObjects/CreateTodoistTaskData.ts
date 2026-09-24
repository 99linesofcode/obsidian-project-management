// The input the core hands the port to create a Todoist task. sectionId and
// parentId are mutually exclusive in practice: a subtask inherits its parent's
// section (dt-02), so a nested task is placed by parentId alone. labels are
// derived from the note's type (dt-09), never free-form. description carries
// the issue deep link for issue-backed tasks; captured drafts leave it empty.
export interface CreateTodoistTaskData {
  projectId: string;
  sectionId?: string;
  parentId?: string;
  content: string;
  labels?: string[];
  description?: string;
}
