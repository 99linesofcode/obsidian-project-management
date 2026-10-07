import { isRecord } from '../shared/isRecord.js';
import { DEFAULT_LABEL_COLOR } from '../shared/labels.js';
import type { AttachProjectData } from '../shared/AttachProjectData.js';
import type { BoardItemData } from '../shared/BoardItemData.js';
import { BoardStatusData } from '../shared/BoardStatusData.js';
import type { CreateIssueData } from '../shared/CreateIssueData.js';
import type { IssueHandleData } from '../shared/IssueHandleData.js';
import type { ProjectBoardData } from '../shared/ProjectBoardData.js';
import type { ProjectData } from '../shared/ProjectData.js';
import {
  ProjectIdentityData,
  type ProjectStatusOption,
} from '../shared/ProjectIdentityData.js';
import type { ProjectStateData } from '../shared/ProjectStateData.js';
import type { ProjectDetailData } from '../shared/ProjectDetailData.js';
import type { RemoteBoardData } from '../shared/RemoteBoardData.js';
import type {
  RepoBoardData,
  RepositoryBoardsData,
} from '../shared/RepoBoardData.js';
import type { GithubTaskData } from './GithubTaskData.js';
import { ProjectMapper } from '../projects/ProjectMapper.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';

// The transport the adapter talks through, injected so tests can fake it.
// GraphQL goes over POST, the REST reads over GET, the REST update over
// PATCH. getConditional is the watched-repo read: it carries an If-None-Match
// header when an etag is given and surfaces the response's etag, so a quiet
// repository answers 304 without spending rate limit. The adapter stays
// token-agnostic; production wiring injects a transport that adds the
// Authorization header.
export interface Transport {
  post(body: string): Promise<{ status: number; json: unknown }>;
  get(path: string): Promise<{ status: number; json: unknown }>;
  getConditional(
    path: string,
    etag?: string,
  ): Promise<{ status: number; json: unknown; etag?: string }>;
  patch(path: string, body: string): Promise<{ status: number; json: unknown }>;
  postPath(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }>;
}

interface RepoParts {
  owner: string;
  name: string;
}

interface BoardParts {
  kind: 'users' | 'orgs';
  login: string;
  number: number;
}

interface StatusField {
  id: string;
  options: ProjectStatusOption[];
}

const REPO_QUERY = `
  query RepoNodeId($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) { id }
  }
`;

const USER_PROJECT_QUERY = `
  query ProjectIdentity($login: String!, $number: Int!) {
    user(login: $login) {
      projectV2(number: $number) {
        id
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
        repositories(first: 10) {
          nodes { url }
        }
      }
    }
  }
`;

const ORG_PROJECT_QUERY = `
  query ProjectIdentity($login: String!, $number: Int!) {
    organization(login: $login) {
      projectV2(number: $number) {
        id
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
        repositories(first: 10) {
          nodes { url }
        }
      }
    }
  }
`;

// The canonical project read: one node query returns the ProjectV2 content
// (title, closed, Status options) the core reasons about. The adapter maps it
// onto ProjectData; the raw ProjectV2 shape never crosses the port.
const PROJECT_CONTENT_QUERY = `
  query ProjectContent($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        title
        closed
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    }
  }
`;

const BOARD_ITEMS_QUERY = `
  query BoardItems($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            id
            type
            updatedAt
            content {
              ... on Issue {
                url
              }
              ... on DraftIssue {
                title
                body
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2SingleSelectField {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// The whole-project fetch: the repository's issues (with bodies, so checklist
// → to-do extraction works from the same response) and the project's board
// items (cards + Status lanes), in ONE GraphQL round trip. Both connections
// are capped at 100 nodes — the same cap the board query always had; a project
// with more than 100 issues or cards is a follow-up pagination concern.
const PROJECT_DETAIL_QUERY = `
  query ProjectDetail($owner: String!, $name: String!, $projectId: ID!) {
    repository(owner: $owner, name: $name) {
      issues(first: 100, states: [OPEN, CLOSED]) {
        nodes {
          url
          number
          id
          title
          body
          state
          createdAt
          lastEditedAt
          updatedAt
          labels(first: 20) {
            nodes { name }
          }
          parent { url }
        }
      }
    }
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            id
            type
            updatedAt
            content {
              ... on Issue {
                url
              }
              ... on DraftIssue {
                title
                body
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2SingleSelectField {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const SET_BOARD_STATUS_MUTATION = `
  mutation SetBoardStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) {
      projectV2Item { id }
    }
  }
`;

const ADD_BOARD_ITEM_MUTATION = `
  mutation AddBoardItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`;

const DELETE_BOARD_ITEM_MUTATION = `
  mutation DeleteBoardItem($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      deletedItemId
    }
  }
`;

const CONVERT_DRAFT_ISSUE_MUTATION = `
  mutation ConvertDraftIssue($itemId: ID!, $repositoryId: ID!) {
    convertProjectV2DraftIssueItemToIssue(
      input: { itemId: $itemId, repositoryId: $repositoryId }
    ) {
      item {
        content {
          ... on Issue {
            url
          }
        }
      }
    }
  }
`;

const SET_PROJECT_CLOSED_MUTATION = `
  mutation SetProjectClosed($projectId: ID!, $closed: Boolean!) {
    updateProjectV2(input: { projectId: $projectId, closed: $closed }) {
      projectV2 { id }
    }
  }
`;

// The owner a created board is created under. WHY the viewer and not the
// repository's owner: a user-owned repo's board may be user- or org-owned, and
// the token's own account is the only owner the plugin can address without an
// extra owner-type lookup. The board is linked to the repo explicitly.
const VIEWER_QUERY = `
  query Viewer {
    viewer { id }
  }
`;

// The repository's linked boards (the derivation ladder's listing) plus the
// repository node id, in one read. The ladder keys on the repo name; adoption
// re-resolves field ids through the identity read, so the listing stays cheap.
// Capped at 100 boards: a repository with more is a follow-up pagination
// concern, not a silent truncation the ladder can act on.
const REPO_BOARDS_QUERY = `
  query RepoBoards($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      projectsV2(first: 100) {
        nodes {
          id
          title
          url
        }
      }
    }
  }
`;

// Creates a board under the viewer. The board is linked to the repository in a
// separate mutation (linkProjectV2ToRepository) and given its Status field
// (createProjectV2Field), so the three scaffolding steps are explicit.
const CREATE_BOARD_MUTATION = `
  mutation CreateBoard($ownerId: ID!, $title: String!) {
    createProjectV2(input: { ownerId: $ownerId, title: $title }) {
      projectV2 {
        id
        url
      }
    }
  }
`;

const LINK_BOARD_MUTATION = `
  mutation LinkBoard($projectId: ID!, $repositoryId: ID!) {
    linkProjectV2ToRepository(
      input: { projectId: $projectId, repositoryId: $repositoryId }
    ) {
      repository { id }
    }
  }
`;

// The Status single-select field a created board gets, carrying the configured
// option names. Each option needs a color and description; a neutral gray and
// an empty description are the sensible defaults.
const CREATE_STATUS_FIELD_MUTATION = `
  mutation CreateStatusField(
    $projectId: ID!
    $options: [ProjectV2SingleSelectFieldOptionInput!]!
  ) {
    createProjectV2Field(
      input: {
        projectId: $projectId
        dataType: SINGLE_SELECT
        name: "Status"
        singleSelectOptions: $options
      }
    ) {
      projectV2Field {
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name }
        }
      }
    }
  }
`;

// The repository's label by name, for resolving the `type:*` label id a created
// issue carries. A missing label resolves to null and is created first.
const LABEL_QUERY = `
  query Label($owner: String!, $name: String!, $label: String!) {
    repository(owner: $owner, name: $name) {
      label(name: $label) { id }
    }
  }
`;

// Creates an issue already linked to its board (projectV2Ids) and carrying its
// type label (labelIds), in one mutation. The issue is born tracked and on the
// board, so no follow-up membership write is needed.
const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue(
    $repositoryId: ID!
    $title: String!
    $body: String
    $labelIds: [ID!]
    $projectV2Ids: [ID!]
  ) {
    createIssue(
      input: {
        repositoryId: $repositoryId
        title: $title
        body: $body
        labelIds: $labelIds
        projectV2Ids: $projectV2Ids
      }
    ) {
      issue { id url }
    }
  }
`;

// The viewer's boards (PRJ-3). createdAt is the capture cursor's clock and url
// is the note's board anchor; both ride on the canonical ProjectData the
// adapter returns, so the raw ProjectV2 shape never crosses the port.
const VIEWER_PROJECTS_QUERY = `
  query ViewerProjects {
    viewer {
      projectsV2(first: 100) {
        nodes {
          id
          title
          url
          closed
          createdAt
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
          repositories(first: 10) {
            nodes { url }
          }
        }
      }
    }
  }
`;

// lockReason is omitted: the enum (RESOLVED/OFF_TOPIC/TOO_HEATED/SPAM) has no
// "archived" reason, and the schema makes it optional. Re-locking an
// already-locked issue is a no-op, so the archive retry is safe.
const LOCK_ISSUE_MUTATION = `
  mutation LockIssue($nodeId: ID!) {
    lockLockable(input: { lockableId: $nodeId }) {
      lockedRecord { ... on Issue { locked } }
    }
  }
`;

// Implements the project management port against GitHub's GraphQL API.
// Maps raw responses onto the identity DTO; the core never sees GitHub JSON.
// The adapter is repo-agnostic infrastructure: the repo url is passed per
// call (from the attached project's identity) rather than bound at
// construction, so constructing it can never fail on a bad url.
export class GitHubAdapter implements ProjectManagementPort {
  // The token viewer's node id, resolved lazily and cached for the adapter's
  // lifetime (the token never changes while the plugin runs).
  private cachedViewerId: string | null = null;

  constructor(private readonly transport: Transport) {}

  async fetchProjectIdentity(
    data: AttachProjectData,
  ): Promise<ProjectIdentityData | null> {
    const board = this.parseBoardUrl(data.boardUrl);
    // A board without a repository yet: the board alone resolves the identity,
    // and repoUrl/repoNodeId stay empty. Used by the board-born capture path
    // (PRJ-3), which has a board but no repo, and by the derivation ladder to
    // adopt a selected board and re-resolve its field ids.
    const repoNodeId =
      data.repoUrl === ''
        ? ''
        : await this.fetchRepoNodeId(this.parseRepoUrl(data.repoUrl));
    const project = await this.fetchProjectByBoard(board);

    return new ProjectIdentityData({
      repoUrl: data.repoUrl,
      repoNodeId,
      projectNodeId: project.id,
      statusFieldId: project.statusFieldId,
      statusOptions: project.statusOptions,
    });
  }

  // The repository's node id and its linked boards, in one read. The
  // derivation ladder keys on the repo name; a malformed board node is skipped
  // rather than failing the whole listing.
  async fetchRepoBoards(repoUrl: string): Promise<RepositoryBoardsData> {
    const repo = this.parseRepoUrl(repoUrl);
    const data = await this.postQuery(REPO_BOARDS_QUERY, {
      owner: repo.owner,
      name: repo.name,
    });
    const repository = data.repository;
    if (!isRecord(repository) || typeof repository.id !== 'string') {
      throw new Error(
        `GitHubAdapter: repository ${repo.owner}/${repo.name} not found`,
      );
    }
    const nodes =
      isRecord(repository.projectsV2) &&
      Array.isArray(repository.projectsV2.nodes)
        ? repository.projectsV2.nodes
        : [];
    const boards: RepoBoardData[] = [];
    for (const node of nodes) {
      if (!isRecord(node) || typeof node.id !== 'string') {
        continue;
      }
      boards.push({
        projectNodeId: node.id,
        name: typeof node.title === 'string' ? node.title : '',
        boardUrl: typeof node.url === 'string' ? node.url : '',
      });
    }
    return { repoNodeId: repository.id, boards };
  }

  // Creates a board titled with the repository's name under the token's viewer,
  // links it to the repository, and creates its Status single-select field with
  // the configured option names. The viewer id is resolved once and cached: a
  // fleet of projects creates their boards in one pass, and the viewer never
  // changes for the token's lifetime.
  async createBoardWithStatusField(
    repoUrl: string,
    statusOptions: string[],
  ): Promise<ProjectBoardData> {
    const repo = this.parseRepoUrl(repoUrl);
    const repositoryId = await this.fetchRepoNodeId(repo);
    const ownerId = await this.viewerId();

    const created = await this.postQuery(CREATE_BOARD_MUTATION, {
      ownerId,
      title: repo.name,
    });
    const payload = created.createProjectV2;
    const project =
      isRecord(payload) && isRecord(payload.projectV2)
        ? payload.projectV2
        : undefined;
    if (!project || typeof project.id !== 'string') {
      throw new Error('GitHubAdapter: create board returned no project');
    }
    const projectNodeId = project.id;
    const boardUrl = typeof project.url === 'string' ? project.url : '';

    await this.linkBoard(projectNodeId, repositoryId);
    const status = await this.createStatusField(projectNodeId, statusOptions);
    return {
      projectNodeId,
      boardUrl,
      statusFieldId: status.id,
      statusOptions: status.options,
    };
  }

  // Adopts an existing board: links it to the repository and ensures it carries
  // a Status field. Heals an interrupted creation — a board created but not yet
  // linked, or linked but without its Status field — so the next pass adopts it
  // instead of creating a duplicate.
  async adoptBoard(
    boardUrl: string,
    repoUrl: string,
    statusOptions: string[],
  ): Promise<ProjectBoardData> {
    const board = this.parseBoardUrl(boardUrl);
    const repo = this.parseRepoUrl(repoUrl);
    const repositoryId = await this.fetchRepoNodeId(repo);
    const project = await this.fetchProjectFieldsByBoard(board);
    const status =
      project.status.id === ''
        ? await this.createStatusField(project.id, statusOptions)
        : project.status;
    await this.linkBoard(project.id, repositoryId);
    return {
      projectNodeId: project.id,
      boardUrl,
      statusFieldId: status.id,
      statusOptions: status.options,
    };
  }

  private async linkBoard(
    projectNodeId: string,
    repositoryId: string,
  ): Promise<void> {
    await this.postQuery(LINK_BOARD_MUTATION, { projectId: projectNodeId, repositoryId });
  }

  private async createStatusField(
    projectNodeId: string,
    statusOptions: string[],
  ): Promise<StatusField> {
    const fieldData = await this.postQuery(CREATE_STATUS_FIELD_MUTATION, {
      projectId: projectNodeId,
      options: statusOptions.map((name) => ({
        name,
        color: 'GRAY',
        description: '',
      })),
    });
    const fieldPayload = fieldData.createProjectV2Field;
    const fieldNode =
      isRecord(fieldPayload) && isRecord(fieldPayload.projectV2Field)
        ? fieldPayload.projectV2Field
        : undefined;
    const status = this.statusFieldOrEmpty({
      nodes: fieldNode === undefined ? [] : [fieldNode],
    });
    if (status.id === '') {
      throw new Error('GitHubAdapter: create board returned no Status field');
    }
    return status;
  }

  // The repository's existing label names, for the seed action's skip check.
  // Paginated: a repo with more than 100 labels would otherwise hide the tail,
  // and the seed action would try to create an existing label (a 422).
  async listRepoLabels(repoUrl: string): Promise<string[]> {
    const repo = this.parseRepoUrl(repoUrl);
    const names: string[] = [];
    for (let page = 1; ; page++) {
      const path = `/repos/${repo.owner}/${repo.name}/labels?per_page=100&page=${page}`;
      const response = await this.transport.get(path);
      if (response.status !== 200) {
        throw new Error(
          `GitHubAdapter: REST request failed with status ${response.status}`,
        );
      }
      if (!Array.isArray(response.json)) {
        throw new Error('GitHubAdapter: unexpected REST response shape');
      }
      names.push(
        ...response.json
          .filter(isRecord)
          .filter(
            (label): label is { name: string } =>
              typeof label.name === 'string',
          )
          .map((label) => label.name),
      );
      if (response.json.length < 100) {
        break;
      }
    }
    return names;
  }

  // Creates one label on the repository. The seed action calls it only for
  // labels the listing did not already carry, so it is not idempotent on its
  // own; a duplicate name is a 422 the caller never triggers.
  async createRepoLabel(
    repoUrl: string,
    name: string,
    color: string,
  ): Promise<void> {
    const repo = this.parseRepoUrl(repoUrl);
    const path = `/repos/${repo.owner}/${repo.name}/labels`;
    const response = await this.transport.postPath(
      path,
      JSON.stringify({ name, color }),
    );
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(
        `GitHubAdapter: REST request failed with status ${response.status}`,
      );
    }
  }

  // The viewer's ProjectV2 boards, mapped onto canonical ProjectData (PRJ-3).
  // A malformed node is skipped rather than failing the whole listing. The
  // board's linked repositories ride along for the board-born capture.
  async fetchViewerProjects(): Promise<RemoteBoardData[]> {
    const data = await this.postQuery(VIEWER_PROJECTS_QUERY, {});
    const viewer = data.viewer;
    const nodes =
      isRecord(viewer) &&
      isRecord(viewer.projectsV2) &&
      Array.isArray(viewer.projectsV2.nodes)
        ? viewer.projectsV2.nodes
        : [];
    const boards: RemoteBoardData[] = [];
    for (const node of nodes) {
      if (!isRecord(node) || typeof node.id !== 'string') {
        continue;
      }
      const repositoryNodes =
        isRecord(node.repositories) && Array.isArray(node.repositories.nodes)
          ? node.repositories.nodes
          : [];
      const repoUrls = repositoryNodes
        .filter(isRecord)
        .filter(
          (repository): repository is { url: string } =>
            typeof repository.url === 'string' && repository.url !== '',
        )
        .map((repository) => repository.url);
      boards.push({
        project: ProjectMapper.fromCodeHostBoard(
          {
            id: node.id,
            name: typeof node.title === 'string' ? node.title : '',
            closed: node.closed === true,
            createdAt:
              typeof node.createdAt === 'string' ? node.createdAt : null,
            url: typeof node.url === 'string' ? node.url : '',
            statusOptions: this.statusFieldOrEmpty(node.fields).options,
          },
          { path: '', doneLane: '', archivedAt: null, repoUrl: '' },
        ),
        repoUrls,
      });
    }
    return boards;
  }

  // The token viewer's node id, resolved once and cached.
  private async viewerId(): Promise<string> {
    if (this.cachedViewerId !== null) {
      return this.cachedViewerId;
    }
    const data = await this.postQuery(VIEWER_QUERY, {});
    const viewer = data.viewer;
    if (!isRecord(viewer) || typeof viewer.id !== 'string') {
      throw new Error('GitHubAdapter: viewer not found');
    }
    this.cachedViewerId = viewer.id;
    return viewer.id;
  }

  // The canonical project read. The ProjectV2 node is mapped onto ProjectData
  // at the boundary; the option ids stay in the identity storage shape, so the
  // core only ever sees the canonical content.
  async fetchProject(
    repoUrl: string,
    projectNodeId: string,
    doneLane: string,
  ): Promise<ProjectData> {
    const data = await this.postQuery(PROJECT_CONTENT_QUERY, {
      projectId: projectNodeId,
    });
    const project = data.node;
    if (!isRecord(project) || typeof project.id !== 'string') {
      throw new Error('GitHubAdapter: project not found');
    }
    const status = this.findStatusField(project.fields);
    return ProjectMapper.fromCodeHostProject(
      {
        id: project.id,
        name: typeof project.title === 'string' ? project.title : '',
        closed: project.closed === true,
        statusOptions: status.options,
      },
      { path: '', doneLane, archivedAt: null, repoUrl },
    );
  }

  // Creates a new issue from a vault-born task's canonical view, already linked
  // to its board (projectV2Ids) and carrying its `type:*` label, in one GraphQL
  // mutation. The label id is resolved (and the label created if absent) first,
  // so the issue is born tracked and on the board — no follow-up membership
  // write. promoteCard's draft conversion is a different path (it needs an
  // existing draft card), so it is not reused here.
  async createIssue(
    repoUrl: string,
    payload: CreateIssueData,
  ): Promise<IssueHandleData> {
    const repo = this.parseRepoUrl(repoUrl);
    const repositoryId = await this.fetchRepoNodeId(repo);
    const labelIds =
      payload.type === ''
        ? []
        : [await this.ensureLabelId(repo, `type: ${payload.type}`)];

    const data = await this.postQuery(CREATE_ISSUE_MUTATION, {
      repositoryId,
      title: payload.title,
      body: payload.body,
      labelIds,
      projectV2Ids: payload.projectV2Ids,
    });
    const created = data.createIssue;
    const issue =
      isRecord(created) && isRecord(created.issue) ? created.issue : undefined;
    if (!issue || typeof issue.url !== 'string' || issue.url === '') {
      throw new Error('GitHubAdapter: create issue returned no url');
    }
    return {
      url: issue.url,
      nodeId: typeof issue.id === 'string' ? issue.id : '',
    };
  }

  // The node id of a repository label, creating it with the default color when
  // it does not exist yet. The seed action normally creates the type labels, so
  // this is the fallback that keeps a fresh repo's first issue tracked.
  private async ensureLabelId(repo: RepoParts, label: string): Promise<string> {
    const data = await this.postQuery(LABEL_QUERY, {
      owner: repo.owner,
      name: repo.name,
      label,
    });
    const repository = data.repository;
    if (
      isRecord(repository) &&
      isRecord(repository.label) &&
      typeof repository.label.id === 'string'
    ) {
      return repository.label.id;
    }
    const path = `/repos/${repo.owner}/${repo.name}/labels`;
    const response = await this.transport.postPath(
      path,
      JSON.stringify({ name: label, color: DEFAULT_LABEL_COLOR }),
    );
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(
        `GitHubAdapter: REST request failed with status ${response.status}`,
      );
    }
    if (!isRecord(response.json) || typeof response.json.node_id !== 'string') {
      throw new Error('GitHubAdapter: create label returned no node id');
    }
    return response.json.node_id;
  }

  async fetchTrackedIssues(repoUrl: string): Promise<GithubTaskData[]> {
    const repo = this.parseRepoUrl(repoUrl);
    const issues: Record<string, unknown>[] = [];

    for (let page = 1; ; page++) {
      const path = `/repos/${repo.owner}/${repo.name}/issues?state=all&per_page=100&page=${page}`;
      const response = await this.transport.get(path);
      if (response.status !== 200) {
        throw new Error(
          `GitHubAdapter: REST request failed with status ${response.status}`,
        );
      }
      if (!Array.isArray(response.json)) {
        throw new Error('GitHubAdapter: unexpected REST response shape');
      }

      const pageIssues = response.json.filter(isRecord);
      issues.push(...pageIssues);
      if (pageIssues.length < 100) {
        break;
      }
    }

    return issues
      .filter((issue) => this.isTrackedIssue(issue))
      .map((issue) => this.mapIssue(issue));
  }

  private isTrackedIssue(issue: Record<string, unknown>): boolean {
    // The vault is the source of truth: every issue carrying a type label
    // (type: task, type: bug, type: chore, type: slice, ...) is tracked.
    if (!Array.isArray(issue.labels)) {
      return false;
    }
    return issue.labels.some(
      (label) =>
        isRecord(label) &&
        typeof label.name === 'string' &&
        label.name.startsWith('type:'),
    );
  }

  // The whole-project fetch the sync chain works from: one GraphQL POST
  // returns the repository's issues (bodies included) and the project's board
  // items. The adapter filters to typed issues here, so the core receives the
  // tracked set; the board cards come along for the lane join.
  async fetchProjectDetail(
    repoUrl: string,
    projectNodeId: string,
  ): Promise<ProjectDetailData> {
    const repo = this.parseRepoUrl(repoUrl);
    const data = await this.postQuery(PROJECT_DETAIL_QUERY, {
      owner: repo.owner,
      name: repo.name,
      projectId: projectNodeId,
    });

    const repository = data.repository;
    const issueNodes =
      isRecord(repository) &&
      isRecord(repository.issues) &&
      Array.isArray(repository.issues.nodes)
        ? repository.issues.nodes
        : [];
    const issues = issueNodes
      .filter(isRecord)
      .map((node) => this.mapGraphqlIssue(node))
      .filter((issue) =>
        issue.labels.some((label) => label.startsWith('type:')),
      );

    const project = data.node;
    const cardNodes =
      isRecord(project) &&
      isRecord(project.items) &&
      Array.isArray(project.items.nodes)
        ? project.items.nodes
        : [];
    const cards = cardNodes
      .filter(isRecord)
      .map((node) => this.mapBoardItem(node))
      .filter((item): item is BoardItemData => item !== null);

    return { issues, cards };
  }

  // Maps a GraphQL issue node onto the transport DTO. GraphQL names differ
  // from REST (url/id/updatedAt, labels as a connection, uppercase state).
  private mapGraphqlIssue(node: Record<string, unknown>): GithubTaskData {
    const labels =
      isRecord(node.labels) && Array.isArray(node.labels.nodes)
        ? node.labels.nodes
            .filter(isRecord)
            .filter(
              (label): label is { name: string } =>
                typeof label.name === 'string',
            )
            .map((label) => label.name)
        : [];

    return {
      url: typeof node.url === 'string' ? node.url : '',
      nodeId: typeof node.id === 'string' ? node.id : '',
      title: typeof node.title === 'string' ? node.title : '',
      body: typeof node.body === 'string' ? node.body : '',
      state: node.state === 'CLOSED' ? 'closed' : 'open',
      createdAt: typeof node.createdAt === 'string' ? node.createdAt : null,
      // The GraphQL Issue type carries lastEditedAt, which moves only on
      // title/body edits — unlike updatedAt, which comments bump.
      lastEditedAt:
        typeof node.lastEditedAt === 'string' ? node.lastEditedAt : null,
      updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : '',
      labels,
      // A sub-issue exposes its parent issue's url; a top-level issue answers
      // null. The url is the parent's github mirror handle.
      parentUrl:
        isRecord(node.parent) && typeof node.parent.url === 'string'
          ? node.parent.url
          : null,
    };
  }

  // The watched-repo read: the newest issues by creation date, through a
  // conditional request. A 304 means nothing changed since the stored etag and
  // costs no rate limit. The issues REST endpoint returns pull requests too,
  // and a PR is not an issue, so entries carrying a pull_request key are
  // filtered out before the newest created_at is read.
  async fetchLatestIssueActivity(
    repoUrl: string,
    etag?: string,
  ): Promise<{
    changed: boolean;
    newestCreatedAt: string | null;
    etag: string | null;
  }> {
    const repo = this.parseRepoUrl(repoUrl);
    const path = `/repos/${repo.owner}/${repo.name}/issues?state=all&sort=created&direction=desc&per_page=10`;

    const response = await this.transport.getConditional(path, etag);
    if (response.status === 304) {
      return { changed: false, newestCreatedAt: null, etag: null };
    }
    if (response.status !== 200) {
      throw new Error(
        `GitHubAdapter: REST request failed with status ${response.status}`,
      );
    }
    if (!Array.isArray(response.json)) {
      throw new Error('GitHubAdapter: unexpected REST response shape');
    }

    const issues = response.json
      .filter(isRecord)
      .filter((entry) => !('pull_request' in entry));
    const newest = issues[0];
    const newestCreatedAt =
      newest && typeof newest.created_at === 'string'
        ? newest.created_at
        : null;
    return {
      changed: true,
      newestCreatedAt,
      etag: response.etag ?? null,
    };
  }

  async fetchUnpromotedIssues(repoUrl: string): Promise<GithubTaskData[]> {
    const repo = this.parseRepoUrl(repoUrl);
    // Open issues only; the client-side filter keeps untyped issues, so the
    // promote modal only offers what can be promoted.
    const path = `/repos/${repo.owner}/${repo.name}/issues?state=open&per_page=100`;

    const response = await this.transport.get(path);
    if (response.status !== 200) {
      throw new Error(
        `GitHubAdapter: REST request failed with status ${response.status}`,
      );
    }
    if (!Array.isArray(response.json)) {
      throw new Error('GitHubAdapter: unexpected REST response shape');
    }

    return response.json
      .filter(isRecord)
      .filter((issue) => this.isUnpromoted(issue))
      .map((issue) => this.mapIssue(issue));
  }

  private isUnpromoted(issue: Record<string, unknown>): boolean {
    if (!Array.isArray(issue.labels)) {
      return false;
    }
    const names = issue.labels
      .filter(isRecord)
      .filter(
        (label): label is { name: string } => typeof label.name === 'string',
      )
      .map((label) => label.name);
    // A typed issue is already tracked, so promoting it would double-track it.
    return !names.some((name) => name.startsWith('type:'));
  }

  async addLabel(url: string, label: string): Promise<void> {
    const repo = this.parseRepoUrl(url);
    const number = this.issueNumberFromUrl(url);
    const path = `/repos/${repo.owner}/${repo.name}/issues/${number}/labels`;

    const response = await this.transport.postPath(
      path,
      JSON.stringify({ labels: [label] }),
    );
    if (response.status !== 200) {
      throw new Error(
        `GitHubAdapter: REST request failed with status ${response.status}`,
      );
    }
  }

  async fetchTask(url: string): Promise<GithubTaskData> {
    const repo = this.parseRepoUrl(url);
    const number = this.issueNumberFromUrl(url);
    const path = `/repos/${repo.owner}/${repo.name}/issues/${number}`;

    const response = await this.transport.get(path);
    if (response.status !== 200) {
      throw new Error(
        `GitHubAdapter: REST request failed with status ${response.status}`,
      );
    }
    if (!isRecord(response.json)) {
      throw new Error('GitHubAdapter: unexpected REST response shape');
    }
    return this.mapIssue(response.json);
  }

  async updateTask(
    url: string,
    input: { title: string; body: string },
  ): Promise<GithubTaskData> {
    const repo = this.parseRepoUrl(url);
    const number = this.issueNumberFromUrl(url);
    const path = `/repos/${repo.owner}/${repo.name}/issues/${number}`;

    const response = await this.transport.patch(path, JSON.stringify(input));
    if (response.status !== 200) {
      throw new Error(
        `GitHubAdapter: REST request failed with status ${response.status}`,
      );
    }
    if (!isRecord(response.json)) {
      throw new Error('GitHubAdapter: unexpected REST response shape');
    }
    return this.mapIssue(response.json);
  }

  async setTaskState(
    url: string,
    state: 'open' | 'closed',
  ): Promise<GithubTaskData> {
    const repo = this.parseRepoUrl(url);
    const number = this.issueNumberFromUrl(url);
    const path = `/repos/${repo.owner}/${repo.name}/issues/${number}`;

    const response = await this.transport.patch(
      path,
      JSON.stringify({ state }),
    );
    if (response.status !== 200) {
      throw new Error(
        `GitHubAdapter: REST request failed with status ${response.status}`,
      );
    }
    if (!isRecord(response.json)) {
      throw new Error('GitHubAdapter: unexpected REST response shape');
    }
    return this.mapIssue(response.json);
  }

  // One cheap query for every project's lightweight state: an aliased node
  // field per id with no connections, so the fleet probe costs about a point
  // per project instead of the board query's 30-50. A missing or invalid node
  // (e.g. a deleted project) is skipped rather than failing the whole probe.
  async fetchProjectStates(
    projectNodeIds: string[],
  ): Promise<Map<string, ProjectStateData>> {
    const states = new Map<string, ProjectStateData>();
    if (projectNodeIds.length === 0) {
      return states;
    }

    const variables: Record<string, string> = {};
    const fields = projectNodeIds.map((id, index) => {
      variables[`id${index}`] = id;
      return `p${index}: node(id: $id${index}) { ... on ProjectV2 { id updatedAt closed } }`;
    });
    const declarations = projectNodeIds
      .map((_, index) => `$id${index}: ID!`)
      .join(', ');
    const query = `
      query FleetState(${declarations}) {
        ${fields.join('\n        ')}
      }
    `;

    const data = await this.postQuery(query, variables);
    for (const raw of Object.values(data)) {
      const state = this.mapProjectState(raw);
      if (state) {
        states.set(state.projectId, state);
      }
    }
    return states;
  }

  async setProjectClosed(
    projectNodeId: string,
    closed: boolean,
  ): Promise<void> {
    await this.postQuery(SET_PROJECT_CLOSED_MUTATION, {
      projectId: projectNodeId,
      closed,
    });
  }

  async lockIssue(nodeId: string): Promise<void> {
    await this.postQuery(LOCK_ISSUE_MUTATION, { nodeId });
  }

  async fetchBoardItems(projectNodeId: string): Promise<BoardItemData[]> {
    const data = await this.postQuery(BOARD_ITEMS_QUERY, {
      projectId: projectNodeId,
    });
    const project = data.node;
    if (
      !isRecord(project) ||
      !isRecord(project.items) ||
      !Array.isArray(project.items.nodes)
    ) {
      throw new Error('GitHubAdapter: unexpected board items response shape');
    }
    return project.items.nodes
      .filter(isRecord)
      .map((node) => this.mapBoardItem(node))
      .filter((item): item is BoardItemData => item !== null);
  }

  async setBoardStatus(status: BoardStatusData): Promise<void> {
    const items = await this.fetchBoardItems(status.projectNodeId);
    const item = items.find(
      (candidate) => candidate.issueUrl === status.issueUrl,
    );
    if (!item) {
      throw new Error(`GitHubAdapter: no board item for ${status.issueUrl}`);
    }
    await this.postQuery(SET_BOARD_STATUS_MUTATION, {
      projectId: status.projectNodeId,
      itemId: item.itemId,
      fieldId: status.statusFieldId,
      optionId: status.statusOptionId,
    });
  }

  // Adds an existing issue to the board. Kept for adopting an untracked issue
  // (materializeUntracked); the outward-creation path links at create time
  // instead, so it never calls this.
  async addBoardItem(projectNodeId: string, issueUrl: string): Promise<void> {
    const task = await this.fetchTask(issueUrl);
    await this.postQuery(ADD_BOARD_ITEM_MUTATION, {
      projectId: projectNodeId,
      contentId: task.nodeId,
    });
  }

  // Resolves the issue's card from the board (the same join setBoardStatus
  // uses) and deletes it. A card-less issue is a no-op, so a sweep can call
  // this without first checking membership.
  //
  // NOTE: deleting an ISSUE removes its board item automatically (verified
  // against the live API), so the issue-deletion paths need no cleanup call.
  // This method exists for removing a card while keeping the issue.
  async deleteCard(projectNodeId: string, issueUrl: string): Promise<void> {
    const items = await this.fetchBoardItems(projectNodeId);
    const item = items.find((candidate) => candidate.issueUrl === issueUrl);
    if (!item) {
      return;
    }
    await this.postQuery(DELETE_BOARD_ITEM_MUTATION, {
      projectId: projectNodeId,
      itemId: item.itemId,
    });
  }

  async promoteCard(
    itemId: string,
    repoNodeId: string,
  ): Promise<GithubTaskData> {
    const data = await this.postQuery(CONVERT_DRAFT_ISSUE_MUTATION, {
      itemId,
      repositoryId: repoNodeId,
    });
    const converted = data.convertProjectV2DraftIssueItemToIssue;
    if (
      !isRecord(converted) ||
      !isRecord(converted.item) ||
      !isRecord(converted.item.content)
    ) {
      throw new Error(
        'GitHubAdapter: unexpected convert draft issue response shape',
      );
    }
    const url = converted.item.content.url;
    if (typeof url !== 'string') {
      throw new Error(
        'GitHubAdapter: convert draft issue returned no issue url',
      );
    }
    return this.fetchTask(url);
  }

  private mapProjectState(raw: unknown): ProjectStateData | null {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.updatedAt !== 'string' ||
      typeof raw.closed !== 'boolean'
    ) {
      return null;
    }
    return { projectId: raw.id, updatedAt: raw.updatedAt, closed: raw.closed };
  }

  private mapBoardItem(node: Record<string, unknown>): BoardItemData | null {
    if (typeof node.id !== 'string') {
      return null;
    }
    const type = node.type === 'DRAFT_ISSUE' ? 'DRAFT_ISSUE' : 'ISSUE';
    const content = isRecord(node.content) ? node.content : undefined;
    const issueUrl =
      content && typeof content.url === 'string' ? content.url : undefined;
    const draftTitle =
      content && typeof content.title === 'string' ? content.title : undefined;
    const draftBody =
      content && typeof content.body === 'string' ? content.body : undefined;
    const statusOptionName = this.statusOptionName(node.fieldValues);
    const item: BoardItemData = {
      itemId: node.id,
      type,
      // ProjectV2Item.updatedAt is the honest lane clock; a board that omits it
      // leaves the hint null and the ladder falls through to the semantic rule.
      updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : null,
    };
    if (issueUrl !== undefined) {
      item.issueUrl = issueUrl;
    }
    if (statusOptionName !== undefined) {
      item.statusOptionName = statusOptionName;
    }
    if (draftTitle !== undefined) {
      item.draftTitle = draftTitle;
    }
    if (draftBody !== undefined) {
      item.draftBody = draftBody;
    }
    return item;
  }

  // Finds the current Status single-select value's option name among a card's
  // field values, so the core can tell whether the card is done.
  private statusOptionName(fieldValues: unknown): string | undefined {
    if (!isRecord(fieldValues) || !Array.isArray(fieldValues.nodes)) {
      return undefined;
    }
    for (const value of fieldValues.nodes) {
      if (
        isRecord(value) &&
        typeof value.name === 'string' &&
        isRecord(value.field) &&
        value.field.name === 'Status'
      ) {
        return value.name;
      }
    }
    return undefined;
  }

  private issueNumberFromUrl(url: string): number {
    const segments = this.pathSegments(url);
    const numberRaw = segments[segments.length - 1];
    const number = Number(numberRaw);
    if (!Number.isInteger(number)) {
      throw new Error(`GitHubAdapter: invalid issue url ${url}`);
    }
    return number;
  }

  private mapIssue(issue: Record<string, unknown>): GithubTaskData {
    const labels = Array.isArray(issue.labels)
      ? issue.labels
          .filter(isRecord)
          .filter(
            (label): label is { name: string } =>
              typeof label.name === 'string',
          )
          .map((label) => label.name)
      : [];

    return {
      url: typeof issue.html_url === 'string' ? issue.html_url : '',
      nodeId: typeof issue.node_id === 'string' ? issue.node_id : '',
      title: typeof issue.title === 'string' ? issue.title : '',
      body: typeof issue.body === 'string' ? issue.body : '',
      state: issue.state === 'closed' ? 'closed' : 'open',
      createdAt: typeof issue.created_at === 'string' ? issue.created_at : null,
      // The REST shape carries no lastEditedAt; updated_at is comment-noisy, so
      // it is not a substitute. The canonical content clock stays unknown here
      // (the GraphQL detail fetch is the sync path and does carry it).
      lastEditedAt: null,
      updatedAt: typeof issue.updated_at === 'string' ? issue.updated_at : '',
      labels,
      // The REST issue shape carries no parent relation (sub-issues are a
      // GraphQL-only field), so a REST-mapped issue is top-level.
      parentUrl: null,
    };
  }

  private async fetchRepoNodeId(repo: RepoParts): Promise<string> {
    const data = await this.postQuery(REPO_QUERY, {
      owner: repo.owner,
      name: repo.name,
    });
    const repository = data.repository;
    if (!isRecord(repository) || typeof repository.id !== 'string') {
      throw new Error(
        `GitHubAdapter: repository ${repo.owner}/${repo.name} not found`,
      );
    }
    return repository.id;
  }

  private async fetchProjectByBoard(board: BoardParts): Promise<{
    id: string;
    statusFieldId: string;
    statusOptions: ProjectStatusOption[];
  }> {
    const query =
      board.kind === 'users' ? USER_PROJECT_QUERY : ORG_PROJECT_QUERY;
    const data = await this.postQuery(query, {
      login: board.login,
      number: board.number,
    });
    const owner = data[board.kind === 'users' ? 'user' : 'organization'];
    if (!isRecord(owner)) {
      throw new Error(`GitHubAdapter: ${board.kind} ${board.login} not found`);
    }
    const project = owner.projectV2;
    if (!isRecord(project) || typeof project.id !== 'string') {
      throw new Error(
        `GitHubAdapter: project ${board.number} not found for ${board.login}`,
      );
    }
    const status = this.findStatusField(project.fields);
    return {
      id: project.id,
      statusFieldId: status.id,
      statusOptions: status.options,
    };
  }

  // The tolerant sibling of fetchProjectByBoard: a board whose Status field has
  // not been created yet yields an empty Status rather than throwing, so the
  // ensure-board healing path can create the field instead of failing.
  private async fetchProjectFieldsByBoard(
    board: BoardParts,
  ): Promise<{ id: string; status: StatusField }> {
    const query =
      board.kind === 'users' ? USER_PROJECT_QUERY : ORG_PROJECT_QUERY;
    const data = await this.postQuery(query, {
      login: board.login,
      number: board.number,
    });
    const owner = data[board.kind === 'users' ? 'user' : 'organization'];
    if (!isRecord(owner)) {
      throw new Error(`GitHubAdapter: ${board.kind} ${board.login} not found`);
    }
    const project = owner.projectV2;
    if (!isRecord(project) || typeof project.id !== 'string') {
      throw new Error(
        `GitHubAdapter: project ${board.number} not found for ${board.login}`,
      );
    }
    return { id: project.id, status: this.statusFieldOrEmpty(project.fields) };
  }

  private findStatusField(fields: unknown): StatusField {
    if (!isRecord(fields) || !Array.isArray(fields.nodes)) {
      throw new Error('GitHubAdapter: project has no fields');
    }
    for (const node of fields.nodes) {
      if (
        !isRecord(node) ||
        node.name !== 'Status' ||
        typeof node.id !== 'string'
      ) {
        continue;
      }
      const options = Array.isArray(node.options)
        ? node.options
            .filter(isRecord)
            .filter(
              (o): o is { id: string; name: string } =>
                typeof o.id === 'string' && typeof o.name === 'string',
            )
            .map((o) => ({ id: o.id, name: o.name }))
        : [];
      return { id: node.id, options };
    }
    throw new Error('GitHubAdapter: project has no Status field');
  }

  // The tolerant sibling of findStatusField: a newly created board or a listing
  // node whose fields have not loaded yet yields an empty Status rather than
  // failing. WHY: the attach path must reject a board with no Status (a real
  // config problem), but a create/list read must not — the user can repair the
  // board and the next pass picks the field up.
  private statusFieldOrEmpty(fields: unknown): StatusField {
    if (!isRecord(fields) || !Array.isArray(fields.nodes)) {
      return { id: '', options: [] };
    }
    for (const node of fields.nodes) {
      if (
        !isRecord(node) ||
        node.name !== 'Status' ||
        typeof node.id !== 'string'
      ) {
        continue;
      }
      const options = Array.isArray(node.options)
        ? node.options
            .filter(isRecord)
            .filter(
              (o): o is { id: string; name: string } =>
                typeof o.id === 'string' && typeof o.name === 'string',
            )
            .map((o) => ({ id: o.id, name: o.name }))
        : [];
      return { id: node.id, options };
    }
    return { id: '', options: [] };
  }

  private async postQuery(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.transport.post(
      JSON.stringify({ query, variables }),
    );
    if (response.status !== 200) {
      throw new Error(
        `GitHubAdapter: GraphQL request failed with status ${response.status}`,
      );
    }
    const json = response.json;
    if (!isRecord(json) || !isRecord(json.data)) {
      throw new Error('GitHubAdapter: unexpected GraphQL response shape');
    }
    return json.data;
  }

  private parseRepoUrl(url: string): RepoParts {
    // The port accepts the `owner/name` shorthand the settings input invites;
    // the provider expands it here, so no neutral action carries the host.
    const normalized = url.includes('://') ? url : `https://github.com/${url}`;
    let path: string[];
    try {
      path = this.pathSegments(normalized);
    } catch {
      throw new Error(`GitHubAdapter: invalid repo url ${url}`);
    }
    if (path.length < 2) {
      throw new Error(`GitHubAdapter: invalid repo url ${url}`);
    }
    return { owner: path[0]!, name: path[1]! };
  }

  private parseBoardUrl(url: string): BoardParts {
    let path: string[];
    try {
      path = this.pathSegments(url);
    } catch {
      throw new Error(`GitHubAdapter: invalid board url ${url}`);
    }
    const kind = path[0];
    const login = path[1];
    const projects = path[2];
    const numberRaw = path[3];
    if (kind !== 'users' && kind !== 'orgs') {
      throw new Error(`GitHubAdapter: invalid board url ${url}`);
    }
    if (
      projects !== 'projects' ||
      login === undefined ||
      numberRaw === undefined
    ) {
      throw new Error(`GitHubAdapter: invalid board url ${url}`);
    }
    const number = Number(numberRaw);
    if (!Number.isInteger(number)) {
      throw new Error(
        `GitHubAdapter: invalid project number in board url ${url}`,
      );
    }
    return { kind, login, number };
  }

  private pathSegments(url: string): string[] {
    return new URL(url).pathname
      .split('/')
      .filter((segment) => segment.length > 0);
  }
}
