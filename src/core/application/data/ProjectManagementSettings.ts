export interface ProjectManagementSettings {
  pollIntervalMinutes: number;
  doneOptionName: string;
  debounceSeconds: number;
  projectTemplatePath: string;
  taskTemplatePath: string;
  projectsBasePath: string;
  tasksBasePath: string;
  statusOptions: string[];
}
