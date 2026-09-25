import type { AttachProjectData } from '../DataTransferObjects/AttachProjectData.js';
import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { ProjectDetailData } from '../DataTransferObjects/ProjectDetailData.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { ProjectStateData } from '../DataTransferObjects/ProjectStateData.js';
import type { GithubTaskData } from '../DataTransferObjects/GithubTaskData.js';

// The core's need: given a project note's sync frontmatter, resolve the
// GitHub identities for that project, fetch the project's whole detail in one
// round trip (tracked issues with bodies + board cards with lanes), probe
// every project's lightweight state in one cheap query, read/update a single
// task by its issue url, set a task's open/closed state, lock an issue's
// conversation, drive the project board (read its cards, set a card's Status,
// add an issue to the board), and watch a repository's newest issue through a
// conditional read. Designed for the core, not to mimic GitHub's API. Returns
// null when the provider is not ours to handle.
export interface ProjectManagementPort {
  fetchProjectIdentity(
    data: AttachProjectData,
  ): Promise<ProjectIdentityData | null>;
  // The whole-project fetch the sync chain works from: tracked issues (with
  // bodies) and the board's cards in one call. Replaces the GitHub half's
  // fetchTrackedIssues + fetchBoardItems pair; the older methods survive for
  // the promote UI and the Todoist projection until t4 migrates them.
  fetchProjectDetail(
    repoUrl: string,
    projectNodeId: string,
  ): Promise<ProjectDetailData>;
  fetchTrackedIssues(repoUrl: string): Promise<GithubTaskData[]>;
  fetchLatestIssueActivity(
    repoUrl: string,
    etag?: string,
  ): Promise<{
    changed: boolean;
    newestCreatedAt: string | null;
    etag: string | null;
  }>;
  fetchProjectStates(
    projectNodeIds: string[],
  ): Promise<Map<string, ProjectStateData>>;
  setProjectClosed(projectNodeId: string, closed: boolean): Promise<void>;
  lockIssue(nodeId: string): Promise<void>;
  fetchUnpromotedIssues(repoUrl: string): Promise<GithubTaskData[]>;
  fetchTask(url: string): Promise<GithubTaskData>;
  updateTask(
    url: string,
    input: { title: string; body: string },
  ): Promise<GithubTaskData>;
  setTaskState(url: string, state: 'open' | 'closed'): Promise<GithubTaskData>;
  fetchBoardItems(projectNodeId: string): Promise<BoardItemData[]>;
  setBoardStatus(
    projectNodeId: string,
    statusFieldId: string,
    issueUrl: string,
    statusOptionId: string,
  ): Promise<void>;
  addBoardItem(projectNodeId: string, issueUrl: string): Promise<void>;
  addLabel(url: string, label: string): Promise<void>;
  promoteCard(itemId: string, repoNodeId: string): Promise<GithubTaskData>;
}
