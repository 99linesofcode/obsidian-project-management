import type { AttachProjectData } from '../DataTransferObjects/AttachProjectData.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';

// The core's need: given a project note's sync frontmatter, resolve the
// GitHub identities for that project, fetch the tasks changed since a cursor,
// and read/update a single task by its issue url. Designed for the core, not
// to mimic GitHub's API. Returns null when the provider is not ours to handle.
export interface ProjectManagementPort {
  fetchProjectIdentity(data: AttachProjectData): Promise<ProjectIdentityData | null>;
  fetchChangedTasks(since: string): Promise<TaskData[]>;
  fetchTask(url: string): Promise<TaskData>;
  updateTask(url: string, input: { title: string; body: string }): Promise<TaskData>;
}
