export interface ProjectManagementSettings {
  pollIntervalMinutes: number;
  doneOptionName: string;
  debounceSeconds: number;
  projectTemplatePath: string;
  taskTemplatePath: string;
  todoTemplatePath: string;
  projectsBasePath: string;
  tasksBasePath: string;
  todosBasePath: string;
  statusOptions: string[];
  typeLabels: string[];
}
