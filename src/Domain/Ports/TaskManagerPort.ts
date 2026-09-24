import type { CreateTodoistTaskData } from '../DataTransferObjects/CreateTodoistTaskData.js';
import type { TodoistProjectData } from '../DataTransferObjects/TodoistProjectData.js';
import type { TodoistSectionData } from '../DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';

// The core's need: mirror the vault's projects, tasks and to-dos into a
// personal task manager. Todoist is a personal task mirror, not a
// project-management provider, so this is a separate port from
// ProjectManagementPort (dt-11): resolve/create/rename/archive a project,
// read/create its lane sections, read its active and completed tasks, create/
// update/move/complete/delete a task, and ensure a derived label exists.
// Designed for the core, not to mimic the Todoist API.
export interface TaskManagerPort {
  fetchProjects(): Promise<TodoistProjectData[]>;
  createProject(name: string): Promise<TodoistProjectData>;
  updateProject(id: string, name: string): Promise<void>;
  setProjectArchived(id: string, archived: boolean): Promise<void>;
  fetchSections(projectId: string): Promise<TodoistSectionData[]>;
  createSection(projectId: string, name: string): Promise<TodoistSectionData>;
  fetchActiveTasks(projectId: string): Promise<TodoistTaskData[]>;
  fetchCompletedTasks(
    projectId: string,
    since: string,
  ): Promise<TodoistTaskData[]>;
  createTask(input: CreateTodoistTaskData): Promise<TodoistTaskData>;
  updateTask(
    id: string,
    input: { content: string; labels: string[] },
  ): Promise<void>;
  moveTask(
    id: string,
    to: { sectionId?: string; parentId?: string },
  ): Promise<void>;
  setTaskCompleted(id: string, completed: boolean): Promise<void>;
  deleteTask(id: string): Promise<void>;
  ensureLabel(name: string): Promise<void>;
}
