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

export interface ProjectManagementPort {
  fetchProjectIdentity(
    data: AttachProjectData,
  ): Promise<ProjectIdentityData | null>;
  fetchProject(
    repoUrl: string,
    projectNodeId: string,
    doneLane: string,
  ): Promise<ProjectData>;
  fetchRepoBoards(repoUrl: string): Promise<RepositoryBoardsData>;
  createBoardWithStatusField(
    repoUrl: string,
    statusOptions: string[],
  ): Promise<ProjectBoardData>;
  adoptBoard(
    boardUrl: string,
    repoUrl: string,
    statusOptions: string[],
  ): Promise<ProjectBoardData>;
  listRepoLabels(repoUrl: string): Promise<string[]>;
  createRepoLabel(repoUrl: string, name: string, color: string): Promise<void>;
  fetchViewerProjects(): Promise<RemoteBoardData[]>;
  createIssue(
    repoUrl: string,
    payload: CreateIssueData,
  ): Promise<IssueHandleData>;
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
  setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<CodeHostTaskData>;
  fetchBoardItems(projectNodeId: string): Promise<BoardItemData[]>;
  setBoardStatus(status: BoardStatusData): Promise<void>;
  addBoardItem(projectNodeId: string, issueUrl: string): Promise<void>;
  deleteCard(projectNodeId: string, issueUrl: string): Promise<void>;
  addLabel(url: string, label: string): Promise<void>;
}
