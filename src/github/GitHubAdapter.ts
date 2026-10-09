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

const SET_PROJECT_CLOSED_MUTATION = `
  mutation SetProjectClosed($projectId: ID!, $closed: Boolean!) {
    updateProjectV2(input: { projectId: $projectId, closed: $closed }) {
      projectV2 { id }
    }
  }
`;

const VIEWER_QUERY = `
  query Viewer {
    viewer { id }
  }
`;

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

const LABEL_QUERY = `
  query Label($owner: String!, $name: String!, $label: String!) {
    repository(owner: $owner, name: $name) {
      label(name: $label) { id }
    }
  }
`;

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

const LOCK_ISSUE_MUTATION = `
  mutation LockIssue($nodeId: ID!) {
    lockLockable(input: { lockableId: $nodeId }) {
      lockedRecord { ... on Issue { locked } }
    }
  }
`;

export class GitHubAdapter implements ProjectManagementPort {
  private cachedViewerId: string | null = null;

  constructor(private readonly transport: Transport) {}

  async fetchProjectIdentity(
    data: AttachProjectData,
  ): Promise<ProjectIdentityData | null> {
    const board = this.parseBoardUrl(data.boardUrl);
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
    await this.postQuery(LINK_BOARD_MUTATION, {
      projectId: projectNodeId,
      repositoryId,
    });
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
      lastEditedAt:
        typeof node.lastEditedAt === 'string' ? node.lastEditedAt : null,
      updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : '',
      labels,
      parentUrl:
        isRecord(node.parent) && typeof node.parent.url === 'string'
          ? node.parent.url
          : null,
    };
  }

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

  async addBoardItem(projectNodeId: string, issueUrl: string): Promise<void> {
    const task = await this.fetchTask(issueUrl);
    await this.postQuery(ADD_BOARD_ITEM_MUTATION, {
      projectId: projectNodeId,
      contentId: task.nodeId,
    });
  }

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
      lastEditedAt: null,
      updatedAt: typeof issue.updated_at === 'string' ? issue.updated_at : '',
      labels,
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
