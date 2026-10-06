import type { AttachProjectData } from '../projects/AttachProjectData.js';
import type { BoardItemData } from './BoardItemData.js';
import type { CodeHostTaskData } from './CodeHostTaskData.js';
import type { CreateIssueData } from './CreateIssueData.js';
import type { IssueHandleData } from './IssueHandleData.js';
import type { ProjectBoardData } from '../projects/ProjectBoardData.js';
import type { ProjectData } from './ProjectData.js';
import type { ProjectDetailData } from './ProjectDetailData.js';
import type { ProjectIdentityData } from '../projects/ProjectIdentityData.js';
import type { ProjectStateData } from '../projects/ProjectStateData.js';

// WHY this port lives in the shared kernel: it is the core's need, designed
// for the core and owned by no provider. A provider's adapter registers from
// its own module; adding a new code host means implementing this contract, not
// digging it out of an existing provider's folder.
//
// The core's need: given a project note's sync frontmatter, resolve the
// code-host identities for that project, fetch the project's whole detail in
// one round trip (tracked issues with bodies + board cards with lanes), probe
// every project's lightweight state in one cheap query, read/update a single
// task by its issue url, set a task's open/closed state, lock an issue's
// conversation, drive the project board (read its cards, set a card's Status,
// add an issue to the board), and watch a repository's newest issue through a
// conditional read. Designed for the core, not to mimic the provider's API.
// Returns null when the provider is not ours to handle.
export interface ProjectManagementPort {
  // Resolves a project note's code-host identities. A note with a board but no
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
  // archivedAt, status option names, done lane). The raw provider shape never
  // crosses the port.
  fetchProject(
    repoUrl: string,
    projectNodeId: string,
    doneLane: string,
  ): Promise<ProjectData>;
  // Creates a new board for a vault-born project (PRJ-1). The owner is the
  // token's viewer: a vault-born project carries no repo/board address yet, so
  // the token's own account is the only defensible owner. Returns the board's
  // addressing for the identity record; repo attachment stays a separate act
  // (ATT-1), so a board without a repo materializes no issues.
  createProject(name: string): Promise<ProjectBoardData>;
  // The viewer's boards, mapped onto canonical ProjectData at the boundary
  // (PRJ-3). The board's url rides on mirrors.github and its creation clock on
  // createdAt, so the capture cursor never sees a raw provider shape.
  fetchViewerProjects(): Promise<ProjectData[]>;
  // Creates a new issue from a vault-born task's canonical view. The adapter
  // renders the vault-owned type as the `type:*` label, so the issue is
  // immediately tracked. Returns the issue's mirror handle.
  createIssue(
    repoUrl: string,
    payload: CreateIssueData,
  ): Promise<IssueHandleData>;
  // The whole-project fetch the sync chain works from: tracked issues (with
  // bodies) and the board's cards in one call. Replaces the code-host half's
  // fetchTrackedIssues + fetchBoardItems pair; the older methods survive for
  // the promote UI and the task-manager projection until t4 migrates them.
  fetchProjectDetail(
    repoUrl: string,
    projectNodeId: string,
  ): Promise<ProjectDetailData>;
  fetchTrackedIssues(repoUrl: string): Promise<CodeHostTaskData[]>;
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
  fetchUnpromotedIssues(repoUrl: string): Promise<CodeHostTaskData[]>;
  fetchTask(url: string): Promise<CodeHostTaskData>;
  updateTask(
    url: string,
    input: { title: string; body: string },
  ): Promise<CodeHostTaskData>;
  setTaskState(url: string, state: 'open' | 'closed'): Promise<CodeHostTaskData>;
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
  promoteCard(itemId: string, repoNodeId: string): Promise<CodeHostTaskData>;
}
