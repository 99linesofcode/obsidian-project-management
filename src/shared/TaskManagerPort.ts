import type { CreateRemoteTaskData } from './CreateRemoteTaskData.js';
import type { RemoteProjectData } from './RemoteProjectData.js';
import type { RemoteSectionData } from './RemoteSectionData.js';
import type { RemoteTaskData } from './RemoteTaskData.js';

// WHY this port lives in the shared kernel: it is the core's need, designed
// for the core and owned by no provider. A provider's adapter registers from
// its own module; adding a new task manager means implementing this contract,
// not digging it out of an existing provider's folder.
//
// The core's need: mirror the vault's projects, tasks and to-dos into a
// personal task manager. A task manager is a personal task mirror, not a
// project-management provider, so this is a separate port from
// ProjectManagementPort (dt-11): resolve/create/rename/archive a project,
// read/create its lane sections, read its active and completed tasks, create/
// update/move/complete/delete a task, and ensure a derived label exists.
// Designed for the core, not to mimic the provider's API.
export interface TaskManagerPort {
  fetchProjects(): Promise<RemoteProjectData[]>;
  // Fetches one project by id, or null when it no longer exists. The list
  // endpoint omits archived projects, so this is the only way to read an
  // archived project's state (and to tell a deleted anchor from an archived
  // one) — the live probe found the list gap.
  fetchProject(id: string): Promise<RemoteProjectData | null>;
  createProject(name: string): Promise<RemoteProjectData>;
  updateProject(id: string, name: string): Promise<void>;
  setProjectArchived(id: string, archived: boolean): Promise<void>;
  fetchSections(projectId: string): Promise<RemoteSectionData[]>;
  createSection(projectId: string, name: string): Promise<RemoteSectionData>;
  // Renames a section in place. A lane rename keeps its section (dt-07), so the
  // section follows the board's option name rather than being duplicated.
  updateSection(id: string, name: string): Promise<void>;
  fetchActiveTasks(projectId: string): Promise<RemoteTaskData[]>;
  fetchCompletedTasks(
    projectId: string,
    since: string,
  ): Promise<RemoteTaskData[]>;
  createTask(input: CreateRemoteTaskData): Promise<RemoteTaskData>;
  updateTask(
    id: string,
    input: { content: string; labels: string[] },
  ): Promise<void>;
  // Places a task. A subtask is moved by parentId; a top-level task by
  // sectionId. parentId: null is an explicit move to the TOP LEVEL (used to
  // flatten a retiring slice twin's children, dt-23), optionally landing in a
  // section so an unparented task keeps its lane.
  moveTask(
    id: string,
    to: { sectionId?: string; parentId?: string | null },
  ): Promise<void>;
  setTaskCompleted(id: string, completed: boolean): Promise<void>;
  deleteTask(id: string): Promise<void>;
  ensureLabel(name: string): Promise<void>;
}
