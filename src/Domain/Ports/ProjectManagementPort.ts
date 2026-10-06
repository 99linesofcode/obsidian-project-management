import type { AttachProjectData } from '../DataTransferObjects/AttachProjectData.js';
import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { CreateIssueData } from '../DataTransferObjects/CreateIssueData.js';
import type { IssueHandleData } from '../DataTransferObjects/IssueHandleData.js';
import type { ProjectBoardData } from '../DataTransferObjects/ProjectBoardData.js';
import type { ProjectData } from '../DataTransferObjects/ProjectData.js';
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
  // Resolves a project note's GitHub identities. A note with a board but no
  // repository yet (repo attachment is a separate ATT-1 act) resolves the board
  // alone: repoUrl/repoNodeId stay empty. A pm: github note with no board is a
  // config error the caller surfaces.
  fetchProjectIdentity(
    data: AttachProjectData,
  ): Promise<ProjectIdentityData | null>;
  // The canonical project read: the provider's project payload mapped onto
  // ProjectData at the boundary. WHY separate from fetchProjectIdentity:
  // identity is attach-time addressing the adapter owns (repo/board/field ids),
  // while ProjectData is the canonical content the core reasons about (name,
  // archivedAt, status option names, done lane). The raw ProjectV2 shape never
  // crosses the port.
  fetchProject(
    repoUrl: string,
    projectNodeId: string,
    doneLane: string,
  ): Promise<ProjectData>;
  // Creates a new ProjectV2 board for a vault-born project (PRJ-1). The owner
  // is the token's viewer: a vault-born project carries no repo/board address
  // yet, so the token's own account is the only defensible owner. Returns the
  // board's addressing for the identity record; repo attachment stays a
  // separate act (ATT-1), so a board without a repo materializes no issues.
  createProject(name: string): Promise<ProjectBoardData>;
  // The viewer's ProjectV2 boards, mapped onto canonical ProjectData at the
  // boundary (PRJ-3). The board's url rides on mirrors.github and its creation
  // clock on createdAt, so the capture cursor never sees a raw provider shape.
  fetchViewerProjects(): Promise<ProjectData[]>;
  // Creates a new issue from a vault-born task's canonical view. The adapter
  // renders the vault-owned type as the `type:*` label, so the issue is
  // immediately tracked. Returns the issue's mirror handle.
  createIssue(
    repoUrl: string,
    payload: CreateIssueData,
  ): Promise<IssueHandleData>;
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
  // Removes the issue's card from the project's board. An issue with no card is
  // a no-op, so a sweep can call it unconditionally.
  deleteCard(projectNodeId: string, issueUrl: string): Promise<void>;
  addLabel(url: string, label: string): Promise<void>;
  promoteCard(itemId: string, repoNodeId: string): Promise<GithubTaskData>;
}
