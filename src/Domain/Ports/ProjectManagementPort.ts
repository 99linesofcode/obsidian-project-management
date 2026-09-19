import type { AttachProjectData } from '../DataTransferObjects/AttachProjectData.js';
import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';

// The core's need: given a project note's sync frontmatter, resolve the
// GitHub identities for that project, fetch the tasks changed since a cursor,
// read/update a single task by its issue url, set a task's open/closed state,
// and drive the project board (read its cards, set a card's Status, add an
// issue to the board). Designed for the core, not to mimic GitHub's API.
// Returns null when the provider is not ours to handle.
export interface ProjectManagementPort {
  fetchProjectIdentity(data: AttachProjectData): Promise<ProjectIdentityData | null>;
  fetchChangedTasks(since: string): Promise<TaskData[]>;
  fetchTask(url: string): Promise<TaskData>;
  updateTask(url: string, input: { title: string; body: string }): Promise<TaskData>;
  setTaskState(url: string, state: 'open' | 'closed'): Promise<TaskData>;
  fetchBoardItems(projectNodeId: string): Promise<BoardItemData[]>;
  setBoardStatus(
    projectNodeId: string,
    statusFieldId: string,
    issueUrl: string,
    statusOptionId: string,
  ): Promise<void>;
  addBoardItem(projectNodeId: string, issueUrl: string): Promise<void>;
}
