import type { AttachProjectData } from './AttachProjectData.js';
import type { BoardItemData } from './BoardItemData.js';
import type { BoardStatusData } from './BoardStatusData.js';
import type { CodeHostTaskData } from './CodeHostTaskData.js';
import type { CreateIssueData } from './CreateIssueData.js';
import type { IssueHandleData } from './IssueHandleData.js';
import type { ProjectBoardData } from './ProjectBoardData.js';
import type { ProjectData } from './ProjectData.js';
import type { ProjectDetailData } from './ProjectDetailData.js';
import type { ProjectIdentityData } from './ProjectIdentityData.js';
import type { ProjectStateData } from './ProjectStateData.js';
import type { RemoteBoardData } from './RemoteBoardData.js';
import type { RepositoryBoardsData } from './RepoBoardData.js';

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
  // Resolves a project note's code-host identities from an explicit board url.
  // Used to adopt a board the derivation ladder already selected, and by the
  // board-born capture path, which has a board but no repository yet. The
  // repo-derived ladder itself is fetchRepoBoards + createBoardWithStatusField.
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
  // The repository's node id and its linked boards, in one listing read. The
  // derivation ladder keys on the repo name: no boards -> create, one -> adopt,
  // several -> adopt the one titled with the repo name. Field ids are not part
  // of the listing; adoption re-resolves them through fetchProjectIdentity.
  fetchRepoBoards(repoUrl: string): Promise<RepositoryBoardsData>;
  // Creates a board titled with the repository's name under the token's viewer,
  // links it to the repository, creates its Status single-select field carrying
  // the configured option names, and returns the board's addressing. The
  // configured vocabulary governs CREATION only; an adopted board keeps its own
  // options.
  createBoardWithStatusField(
    repoUrl: string,
    statusOptions: string[],
  ): Promise<ProjectBoardData>;
  // The repository's existing label names, for the seed action's skip check.
  listRepoLabels(repoUrl: string): Promise<string[]>;
  // Creates one label on the repository with the given color. The seed action
  // calls it only for labels the listing did not already carry.
  createRepoLabel(
    repoUrl: string,
    name: string,
    color: string,
  ): Promise<void>;
  // The viewer's boards, mapped onto canonical ProjectData at the boundary
  // (PRJ-3). The board's url rides on mirrors.github and its creation clock on
  // createdAt, so the capture cursor never sees a raw provider shape. The
  // linked repositories ride alongside: under the repo-only connection model a
  // board is capturable only through exactly one linked repository, so the
  // capture derives the github connection's project from that list and
  // collects an error when it is empty or ambiguous.
  fetchViewerProjects(): Promise<RemoteBoardData[]>;
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
  setBoardStatus(status: BoardStatusData): Promise<void>;
  addBoardItem(projectNodeId: string, issueUrl: string): Promise<void>;
  // Removes the issue's card from the project's board. An issue with no card is
  // a no-op, so a sweep can call it unconditionally.
  deleteCard(projectNodeId: string, issueUrl: string): Promise<void>;
  addLabel(url: string, label: string): Promise<void>;
  promoteCard(itemId: string, repoNodeId: string): Promise<CodeHostTaskData>;
}
