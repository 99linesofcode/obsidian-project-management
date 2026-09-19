import type { AttachProjectData } from '../../Domain/DataTransferObjects/AttachProjectData.js';
import type { BoardItemData } from '../../Domain/DataTransferObjects/BoardItemData.js';
import type {
  ProjectIdentityData,
  ProjectStatusOption,
} from '../../Domain/DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../../Domain/DataTransferObjects/TaskData.js';
import type { ProjectManagementPort } from '../../Domain/Ports/ProjectManagementPort.js';

// The transport the adapter talks through, injected so tests can fake it.
// GraphQL goes over POST, the REST reads over GET, the REST update over
// PATCH. The adapter stays token-agnostic; production wiring injects a
// transport that adds the Authorization header.
export interface Transport {
  post(body: string): Promise<{ status: number; json: unknown }>;
  get(path: string): Promise<{ status: number; json: unknown }>;
  patch(path: string, body: string): Promise<{ status: number; json: unknown }>;
  postPath(path: string, body: string): Promise<{ status: number; json: unknown }>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Implements the project management port against GitHub's GraphQL API.
// Maps raw responses onto the identity DTO; the core never sees GitHub JSON.
// The adapter is repo-agnostic infrastructure: the repo url is passed per
// call (from the attached project's identity) rather than bound at
// construction, so constructing it can never fail on a bad url.
export class GitHubAdapter implements ProjectManagementPort {
  constructor(private readonly transport: Transport) {}

  async fetchProjectIdentity(data: AttachProjectData): Promise<ProjectIdentityData | null> {
    const board = this.parseBoardUrl(data.boardUrl);
    const repo = this.parseRepoUrl(data.repoUrl);

    const repoNodeId = await this.fetchRepoNodeId(repo);
    const project = await this.fetchProject(board);

    return {
      repoUrl: data.repoUrl,
      repoNodeId,
      projectNodeId: project.id,
      statusFieldId: project.statusFieldId,
      statusOptions: project.statusOptions,
    };
  }

  async fetchChangedTasks(repoUrl: string, since: string): Promise<TaskData[]> {
    const repo = this.parseRepoUrl(repoUrl);
    // Single page is fine for v1: the since cursor bounds the result set and
    // per_page=100 covers a typical poll window. Pagination lands with the
    // v2 slices ticket if a project outgrows one page.
    const path =
      `/repos/${repo.owner}/${repo.name}/issues` +
      `?state=all&since=${encodeURIComponent(since)}&per_page=100`;

    const response = await this.transport.get(path);
    if (response.status !== 200) {
      throw new Error(`GitHubAdapter: REST request failed with status ${response.status}`);
    }
    if (!Array.isArray(response.json)) {
      throw new Error('GitHubAdapter: unexpected REST response shape');
    }

    return response.json
      .filter(isRecord)
      .filter((issue) => this.isTaskIssue(issue))
      .map((issue) => this.mapIssue(issue));
  }

  private isTaskIssue(issue: Record<string, unknown>): boolean {
    // v1 materialises tasks only; type:slice arrives with the v2 slices ticket.
    if (!Array.isArray(issue.labels)) {
      return false;
    }
    return issue.labels.some((label) => isRecord(label) && label.name === 'type:task');
  }

  async fetchUnpromotedIssues(repoUrl: string): Promise<TaskData[]> {
    const repo = this.parseRepoUrl(repoUrl);
    // Open issues only; the client-side filter keeps issues that are neither a
    // task nor a slice, so the promote modal only offers what can be promoted.
    const path = `/repos/${repo.owner}/${repo.name}/issues?state=open&per_page=100`;

    const response = await this.transport.get(path);
    if (response.status !== 200) {
      throw new Error(`GitHubAdapter: REST request failed with status ${response.status}`);
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
      .filter((label): label is { name: string } => typeof label.name === 'string')
      .map((label) => label.name);
    return !names.includes('type:task') && !names.includes('type:slice');
  }

  async addLabel(url: string, label: string): Promise<void> {
    const repo = this.parseRepoUrl(url);
    const number = this.issueNumberFromUrl(url);
    const path = `/repos/${repo.owner}/${repo.name}/issues/${number}/labels`;

    const response = await this.transport.postPath(path, JSON.stringify({ labels: [label] }));
    if (response.status !== 200) {
      throw new Error(`GitHubAdapter: REST request failed with status ${response.status}`);
    }
  }

  async fetchTask(url: string): Promise<TaskData> {
    const repo = this.parseRepoUrl(url);
    const number = this.issueNumberFromUrl(url);
    const path = `/repos/${repo.owner}/${repo.name}/issues/${number}`;

    const response = await this.transport.get(path);
    if (response.status !== 200) {
      throw new Error(`GitHubAdapter: REST request failed with status ${response.status}`);
    }
    if (!isRecord(response.json)) {
      throw new Error('GitHubAdapter: unexpected REST response shape');
    }
    return this.mapIssue(response.json);
  }

  async updateTask(url: string, input: { title: string; body: string }): Promise<TaskData> {
    const repo = this.parseRepoUrl(url);
    const number = this.issueNumberFromUrl(url);
    const path = `/repos/${repo.owner}/${repo.name}/issues/${number}`;

    const response = await this.transport.patch(path, JSON.stringify(input));
    if (response.status !== 200) {
      throw new Error(`GitHubAdapter: REST request failed with status ${response.status}`);
    }
    if (!isRecord(response.json)) {
      throw new Error('GitHubAdapter: unexpected REST response shape');
    }
    return this.mapIssue(response.json);
  }

  async setTaskState(url: string, state: 'open' | 'closed'): Promise<TaskData> {
    const repo = this.parseRepoUrl(url);
    const number = this.issueNumberFromUrl(url);
    const path = `/repos/${repo.owner}/${repo.name}/issues/${number}`;

    const response = await this.transport.patch(path, JSON.stringify({ state }));
    if (response.status !== 200) {
      throw new Error(`GitHubAdapter: REST request failed with status ${response.status}`);
    }
    if (!isRecord(response.json)) {
      throw new Error('GitHubAdapter: unexpected REST response shape');
    }
    return this.mapIssue(response.json);
  }

  async fetchBoardItems(projectNodeId: string): Promise<BoardItemData[]> {
    const data = await this.postQuery(BOARD_ITEMS_QUERY, { projectId: projectNodeId });
    const project = data.node;
    if (!isRecord(project) || !isRecord(project.items) || !Array.isArray(project.items.nodes)) {
      throw new Error('GitHubAdapter: unexpected board items response shape');
    }
    return project.items.nodes
      .filter(isRecord)
      .map((node) => this.mapBoardItem(node))
      .filter((item): item is BoardItemData => item !== null);
  }

  async setBoardStatus(
    projectNodeId: string,
    statusFieldId: string,
    issueUrl: string,
    statusOptionId: string,
  ): Promise<void> {
    const items = await this.fetchBoardItems(projectNodeId);
    const item = items.find((candidate) => candidate.issueUrl === issueUrl);
    if (!item) {
      throw new Error(`GitHubAdapter: no board item for ${issueUrl}`);
    }
    await this.postQuery(SET_BOARD_STATUS_MUTATION, {
      projectId: projectNodeId,
      itemId: item.itemId,
      fieldId: statusFieldId,
      optionId: statusOptionId,
    });
  }

  async addBoardItem(projectNodeId: string, issueUrl: string): Promise<void> {
    const task = await this.fetchTask(issueUrl);
    await this.postQuery(ADD_BOARD_ITEM_MUTATION, {
      projectId: projectNodeId,
      contentId: task.nodeId,
    });
  }

  async promoteCard(itemId: string, repoNodeId: string): Promise<TaskData> {
    const data = await this.postQuery(CONVERT_DRAFT_ISSUE_MUTATION, {
      itemId,
      repositoryId: repoNodeId,
    });
    const converted = data.convertProjectV2DraftIssueItemToIssue;
    if (!isRecord(converted) || !isRecord(converted.item) || !isRecord(converted.item.content)) {
      throw new Error('GitHubAdapter: unexpected convert draft issue response shape');
    }
    const url = converted.item.content.url;
    if (typeof url !== 'string') {
      throw new Error('GitHubAdapter: convert draft issue returned no issue url');
    }
    return this.fetchTask(url);
  }

  private mapBoardItem(node: Record<string, unknown>): BoardItemData | null {
    if (typeof node.id !== 'string') {
      return null;
    }
    const type = node.type === 'DRAFT_ISSUE' ? 'DRAFT_ISSUE' : 'ISSUE';
    const content = isRecord(node.content) ? node.content : undefined;
    const issueUrl = content && typeof content.url === 'string' ? content.url : undefined;
    const draftTitle = content && typeof content.title === 'string' ? content.title : undefined;
    const draftBody = content && typeof content.body === 'string' ? content.body : undefined;
    const statusOptionName = this.statusOptionName(node.fieldValues);
    const item: BoardItemData = { itemId: node.id, type };
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

  private mapIssue(issue: Record<string, unknown>): TaskData {
    const labels = Array.isArray(issue.labels)
      ? issue.labels
          .filter(isRecord)
          .filter((label): label is { name: string } => typeof label.name === 'string')
          .map((label) => label.name)
      : [];

    return {
      url: typeof issue.html_url === 'string' ? issue.html_url : '',
      remoteId: typeof issue.number === 'number' ? issue.number : 0,
      nodeId: typeof issue.node_id === 'string' ? issue.node_id : '',
      title: typeof issue.title === 'string' ? issue.title : '',
      body: typeof issue.body === 'string' ? issue.body : '',
      state: issue.state === 'closed' ? 'closed' : 'open',
      updatedAt: typeof issue.updated_at === 'string' ? issue.updated_at : '',
      labels,
    };
  }

  private async fetchRepoNodeId(repo: RepoParts): Promise<string> {
    const data = await this.postQuery(REPO_QUERY, { owner: repo.owner, name: repo.name });
    const repository = data.repository;
    if (!isRecord(repository) || typeof repository.id !== 'string') {
      throw new Error(`GitHubAdapter: repository ${repo.owner}/${repo.name} not found`);
    }
    return repository.id;
  }

  private async fetchProject(board: BoardParts): Promise<{
    id: string;
    statusFieldId: string;
    statusOptions: ProjectStatusOption[];
  }> {
    const query = board.kind === 'users' ? USER_PROJECT_QUERY : ORG_PROJECT_QUERY;
    const data = await this.postQuery(query, { login: board.login, number: board.number });
    const owner = data[board.kind === 'users' ? 'user' : 'organization'];
    if (!isRecord(owner)) {
      throw new Error(`GitHubAdapter: ${board.kind} ${board.login} not found`);
    }
    const project = owner.projectV2;
    if (!isRecord(project) || typeof project.id !== 'string') {
      throw new Error(`GitHubAdapter: project ${board.number} not found for ${board.login}`);
    }
    const status = this.findStatusField(project.fields);
    return { id: project.id, statusFieldId: status.id, statusOptions: status.options };
  }

  private findStatusField(fields: unknown): StatusField {
    if (!isRecord(fields) || !Array.isArray(fields.nodes)) {
      throw new Error('GitHubAdapter: project has no fields');
    }
    for (const node of fields.nodes) {
      if (!isRecord(node) || node.name !== 'Status' || typeof node.id !== 'string') {
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

  private async postQuery(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.transport.post(JSON.stringify({ query, variables }));
    if (response.status !== 200) {
      throw new Error(`GitHubAdapter: GraphQL request failed with status ${response.status}`);
    }
    const json = response.json;
    if (!isRecord(json) || !isRecord(json.data)) {
      throw new Error('GitHubAdapter: unexpected GraphQL response shape');
    }
    return json.data;
  }

  private parseRepoUrl(url: string): RepoParts {
    let path: string[];
    try {
      path = this.pathSegments(url);
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
    if (projects !== 'projects' || login === undefined || numberRaw === undefined) {
      throw new Error(`GitHubAdapter: invalid board url ${url}`);
    }
    const number = Number(numberRaw);
    if (!Number.isInteger(number)) {
      throw new Error(`GitHubAdapter: invalid project number in board url ${url}`);
    }
    return { kind, login, number };
  }

  private pathSegments(url: string): string[] {
    return new URL(url).pathname.split('/').filter((segment) => segment.length > 0);
  }
}
