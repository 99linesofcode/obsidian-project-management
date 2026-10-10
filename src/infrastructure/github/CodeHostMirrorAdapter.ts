import type { CanonicalField } from '../../core/domain/canonicalField.js';
import type { CanonicalFieldWrite } from '../../core/application/data/CanonicalFieldWrite.js';
import { CanonicalProject } from '../../core/application/data/CanonicalProject.js';
import { CanonicalTask } from '../../core/application/data/CanonicalTask.js';
import { CapturedProject } from '../../core/application/data/CapturedProject.js';
import { ProjectActivityObservation } from '../../core/application/data/ProjectActivityObservation.js';
import { ProjectAddressing } from '../../core/application/data/ProjectAddressing.js';
import { ProjectCandidate } from '../../core/application/data/ProjectCandidate.js';
import { ProjectDiscovery } from '../../core/application/data/ProjectDiscovery.js';
import type { ProjectIdentityDataTransferObject } from '../../core/application/data/ProjectIdentityDataTransferObject.js';
import { ProjectSummary } from '../../core/application/data/ProjectSummary.js';
import type { MirrorPort } from '../../core/port/MirrorPort.js';
import type { ProjectSetupPort } from '../../core/port/ProjectSetupPort.js';
import type {
  CodeHostResponse,
  CodeHostTransport,
} from './CodeHostTransport.js';
import { CodeHostTarget, type StatusOption } from './CodeHostTarget.js';

const REPO_QUERY = `
  query RepoNodeId($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) { id }
  }
`;

const PROJECT_CONTENT_QUERY = `
  query ProjectContent($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        title
        closed
      }
    }
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

const PROJECT_FIELDS_QUERY = `
  query ProjectFields($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
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
          labels(first: 20) { nodes { name } }
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
              ... on Issue { url }
              ... on DraftIssue { title body }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
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

const DELETE_BOARD_ITEM_MUTATION = `
  mutation DeleteBoardItem($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      deletedItemId
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

const LABEL_QUERY = `
  query Label($owner: String!, $name: String!, $label: String!) {
    repository(owner: $owner, name: $name) {
      label(name: $label) { id }
    }
  }
`;

const VIEWER_QUERY = `
  query Viewer {
    viewer { id }
  }
`;

const VIEWER_BOARDS_QUERY = `
  query ViewerBoards {
    viewer {
      projectsV2(first: 100) {
        nodes {
          id
          title
          createdAt
          repositories(first: 100) { nodes { url } }
        }
      }
    }
  }
`;

const CREATE_BOARD_MUTATION = `
  mutation CreateBoard($ownerId: ID!, $title: String!) {
    createProjectV2(input: { ownerId: $ownerId, title: $title }) {
      projectV2 { id url }
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

const SET_PROJECT_CLOSED_MUTATION = `
  mutation SetProjectClosed($projectId: ID!, $closed: Boolean!) {
    updateProjectV2(input: { projectId: $projectId, closed: $closed }) {
      projectV2 { id }
    }
  }
`;

const RENAME_PROJECT_MUTATION = `
  mutation RenameProject($projectId: ID!, $title: String!) {
    updateProjectV2(input: { projectId: $projectId, title: $title }) {
      projectV2 { id }
    }
  }
`;

const LOCK_TASK_MUTATION = `
  mutation LockTask($nodeId: ID!) {
    lockLockable(input: { lockableId: $nodeId }) {
      lockedRecord { ... on Issue { locked } }
    }
  }
`;

const UNLOCK_TASK_MUTATION = `
  mutation UnlockTask($nodeId: ID!) {
    unlockLockable(input: { lockableId: $nodeId }) {
      unlockedRecord { ... on Issue { locked } }
    }
  }
`;

const ADD_SUB_ISSUE_MUTATION = `
  mutation AddSubIssue($issueId: ID!, $subIssueId: ID!) {
    addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
      issue { id }
    }
  }
`;

const REMOVE_SUB_ISSUE_MUTATION = `
  mutation RemoveSubIssue($issueId: ID!, $subIssueId: ID!) {
    removeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
      issue { id }
    }
  }
`;

const LABEL_COLOR = 'cccccc';

interface RepoParts {
  owner: string;
  name: string;
}

export interface BoardIdentity {
  readonly projectNodeId: string;
  readonly statusFieldId: string;
  readonly statusOptions: readonly StatusOption[];
}

interface RepoBoard {
  projectNodeId: string;
  name: string;
}

interface StatusField {
  id: string;
  options: readonly StatusOption[];
}

interface RawIssue {
  url: string;
  nodeId: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  createdAt: string | null;
  lastEditedAt: string | null;
  updatedAt: string;
  labels: readonly string[];
  parentUrl: string | null;
}

interface RawCard {
  itemId: string;
  issueUrl: string;
  statusOptionName: string | undefined;
  updatedAt: string | null;
}

interface BoardSnapshot {
  issues: RawIssue[];
  cards: Map<string, RawCard>;
}

export class CodeHostMirrorAdapter implements MirrorPort, ProjectSetupPort {
  private readonly rawTarget: string;
  private readonly boards = new Map<string, Promise<BoardIdentity | null>>();

  constructor(
    private readonly transport: CodeHostTransport,
    target = '',
    private readonly boardIdentity?: () => Promise<ProjectIdentityDataTransferObject | null>,
    private readonly statusOptions: readonly string[] = [],
  ) {
    this.rawTarget = target;
  }

  private get target(): CodeHostTarget {
    return CodeHostTarget.parse(this.rawTarget);
  }

  private board(target: string): Promise<BoardIdentity | null> {
    let board = this.boards.get(target);
    if (board === undefined) {
      board = this.resolveBoard(target);
      this.boards.set(target, board);
    }
    return board;
  }

  private async requireBoard(target: string): Promise<BoardIdentity> {
    const board = await this.board(target);
    if (board === null) {
      throw new Error(
        `code host: repository ${repoParts(target).name} has no board`,
      );
    }
    return board;
  }

  private async resolveBoard(target: string): Promise<BoardIdentity | null> {
    const cached = await this.boardIdentity?.();
    if (
      cached !== undefined &&
      cached !== null &&
      cached.projectHandle !== ''
    ) {
      return {
        projectNodeId: cached.projectHandle,
        statusFieldId: cached.statusFieldHandle,
        statusOptions: cached.statusOptions,
      };
    }
    return this.deriveBoard(target);
  }

  private async deriveBoard(target: string): Promise<BoardIdentity | null> {
    const repo = repoParts(target);
    const data = await this.graphql(REPO_BOARDS_QUERY, {
      owner: repo.owner,
      name: repo.name,
    });
    const repository = data.repository;
    if (!isRecord(repository) || typeof repository.id !== 'string') {
      throw new Error(
        `code host: repository ${repo.owner}/${repo.name} not found`,
      );
    }
    const boards = nodesOf(repository, 'projectsV2')
      .filter(isRecord)
      .flatMap(parseRepoBoard);
    const board = chooseBoard(repo.name, boards);
    if (board === null) {
      return null;
    }
    const fields = await this.graphql(PROJECT_FIELDS_QUERY, {
      projectId: board.projectNodeId,
    });
    const status = statusField(fields.node);
    if (status === null) {
      throw new Error(
        `code host: board ${board.projectNodeId} has no Status field`,
      );
    }
    return {
      projectNodeId: board.projectNodeId,
      statusFieldId: status.id,
      statusOptions: status.options,
    };
  }

  private async findOrphanBoard(name: string): Promise<string | null> {
    const data = await this.graphql(VIEWER_BOARDS_QUERY, {});
    for (const node of nodesOf(data.viewer, 'projectsV2')) {
      if (
        isRecord(node) &&
        node.title === name &&
        typeof node.id === 'string' &&
        nodesOf(node, 'repositories').length === 0
      ) {
        return node.id;
      }
    }
    return null;
  }

  private async createBoard(name: string): Promise<string> {
    const ownerId = await this.viewerId();
    const created = await this.graphql(CREATE_BOARD_MUTATION, {
      ownerId,
      title: name,
    });
    return createdProjectId(created);
  }

  private async ensureStatusField(
    projectId: string,
    statusOptions: readonly string[],
  ): Promise<StatusField> {
    const data = await this.graphql(PROJECT_FIELDS_QUERY, { projectId });
    const existing = statusField(data.node);
    if (existing !== null) {
      return existing;
    }
    return this.createStatusField(projectId, statusOptions);
  }

  private async createStatusField(
    projectId: string,
    statusOptions: readonly string[],
  ): Promise<StatusField> {
    const created = await this.graphql(CREATE_STATUS_FIELD_MUTATION, {
      projectId,
      options: statusOptions.map((name) => ({
        name,
        color: 'GRAY',
        description: '',
      })),
    });
    const field = createdStatusField(created);
    if (field === null) {
      throw new Error('code host: create board returned no Status field');
    }
    return field;
  }

  async readProject(target: string): Promise<CanonicalProject | null> {
    const connection = CodeHostTarget.parse(target);
    const board = await this.board(connection.target);
    if (board === null) {
      return null;
    }
    const data = await this.graphql(PROJECT_CONTENT_QUERY, {
      projectId: board.projectNodeId,
    });
    const project = data.node;
    if (!isRecord(project) || typeof project.id !== 'string') {
      return null;
    }
    return new CanonicalProject({
      handle: project.id,
      name: typeof project.title === 'string' ? project.title : '',
      archived: project.closed === true,
    });
  }

  async createProject(target: string, name: string): Promise<CanonicalProject> {
    const connection = CodeHostTarget.parse(target);
    const repo = repoParts(connection.target);
    const repositoryId = await this.repoNodeId(repo);
    const projectId =
      (await this.findOrphanBoard(name)) ?? (await this.createBoard(name));
    await this.linkBoard(projectId, repositoryId);
    const status = await this.ensureStatusField(projectId, this.statusOptions);
    this.boards.set(
      connection.target,
      Promise.resolve({
        projectNodeId: projectId,
        statusFieldId: status.id,
        statusOptions: status.options,
      }),
    );
    return new CanonicalProject({
      handle: connection.target,
      name,
      archived: false,
    });
  }

  private async linkBoard(
    projectId: string,
    repositoryId: string,
  ): Promise<void> {
    await this.graphql(LINK_BOARD_MUTATION, { projectId, repositoryId });
  }

  async setArchived(target: string, archived: boolean): Promise<void> {
    const connection = CodeHostTarget.parse(target);
    const board = await this.requireBoard(connection.target);
    await this.graphql(SET_PROJECT_CLOSED_MUTATION, {
      projectId: board.projectNodeId,
      closed: archived,
    });
  }

  async renameProject(target: string, name: string): Promise<void> {
    const connection = CodeHostTarget.parse(target);
    const board = await this.requireBoard(connection.target);
    await this.graphql(RENAME_PROJECT_MUTATION, {
      projectId: board.projectNodeId,
      title: name,
    });
  }

  async lockTask(handle: string): Promise<void> {
    const nodeId = await this.issueNodeId(handle);
    await this.graphql(LOCK_TASK_MUTATION, { nodeId });
  }

  async unlockTask(handle: string): Promise<void> {
    const nodeId = await this.issueNodeId(handle);
    await this.graphql(UNLOCK_TASK_MUTATION, { nodeId });
  }

  async archivedTime(_target: string): Promise<string | null> {
    return null;
  }

  async discoverProjects(target: string): Promise<ProjectDiscovery> {
    const connection = CodeHostTarget.parse(target);
    const repo = repoParts(connection.target);
    const data = await this.graphql(REPO_BOARDS_QUERY, {
      owner: repo.owner,
      name: repo.name,
    });
    const repository = data.repository;
    if (!isRecord(repository) || typeof repository.id !== 'string') {
      throw new Error(
        `code host: repository ${repo.owner}/${repo.name} not found`,
      );
    }
    const projects = nodesOf(repository, 'projectsV2')
      .filter(isRecord)
      .flatMap(parseRepoBoard)
      .map(
        (board) =>
          new ProjectSummary({
            handle: board.projectNodeId,
            name: board.name,
          }),
      );
    return new ProjectDiscovery({ targetHandle: repository.id, projects });
  }

  async readProjectAddressing(
    project: ProjectSummary,
  ): Promise<ProjectAddressing | null> {
    const data = await this.graphql(PROJECT_FIELDS_QUERY, {
      projectId: project.handle,
    });
    const node = data.node;
    if (!isRecord(node) || typeof node.id !== 'string') {
      return null;
    }
    const status = statusField(node);
    if (status === null) {
      throw new Error(
        `code host: project ${project.handle} has no Status field`,
      );
    }
    return new ProjectAddressing({
      projectHandle: project.handle,
      statusFieldHandle: status.id,
      statusOptions: status.options,
    });
  }

  async createProjectWithStatus(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing> {
    const connection = CodeHostTarget.parse(target);
    const repo = repoParts(connection.target);
    const repositoryId = await this.repoNodeId(repo);
    const projectId =
      (await this.findOrphanBoard(name)) ?? (await this.createBoard(name));
    await this.linkBoard(projectId, repositoryId);
    const status = await this.ensureStatusField(projectId, statusOptions);
    return new ProjectAddressing({
      projectHandle: projectId,
      statusFieldHandle: status.id,
      statusOptions: status.options,
    });
  }

  async adoptProject(
    target: string,
    project: ProjectSummary,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing> {
    const connection = CodeHostTarget.parse(target);
    const repo = repoParts(connection.target);
    const repositoryId = await this.repoNodeId(repo);
    const status = await this.ensureStatusField(project.handle, statusOptions);
    await this.linkBoard(project.handle, repositoryId);
    return new ProjectAddressing({
      projectHandle: project.handle,
      statusFieldHandle: status.id,
      statusOptions: status.options,
    });
  }

  async listProjects(): Promise<readonly ProjectCandidate[]> {
    const data = await this.graphql(VIEWER_BOARDS_QUERY, {});
    return nodesOf(data.viewer, 'projectsV2')
      .filter(isRecord)
      .flatMap((node) =>
        typeof node.id === 'string'
          ? [
              new ProjectCandidate({
                project: new ProjectSummary({
                  handle: node.id,
                  name: typeof node.title === 'string' ? node.title : '',
                }),
                targets: repoUrlsOf(node),
              }),
            ]
          : [],
      );
  }

  async latestActivity(
    target: string,
    etag?: string,
  ): Promise<ProjectActivityObservation> {
    const connection = CodeHostTarget.parse(target);
    const repo = repoParts(connection.target);
    const path = `/repos/${repo.owner}/${repo.name}/issues?state=all&sort=created&direction=desc&per_page=10`;
    const response = await this.transport.getConditional(path, etag);
    if (response.status === 304) {
      return new ProjectActivityObservation({
        changed: false,
        newestCreatedAt: null,
        etag: null,
      });
    }
    if (response.status !== 200) {
      throw new Error(
        `code host: REST request failed with status ${response.status}`,
      );
    }
    if (!Array.isArray(response.json)) {
      throw new Error('code host: unexpected REST response shape');
    }
    const issues = response.json
      .filter(isRecord)
      .filter((entry) => !('pull_request' in entry));
    const newest = issues[0];
    const newestCreatedAt =
      newest !== undefined && typeof newest.created_at === 'string'
        ? newest.created_at
        : null;
    return new ProjectActivityObservation({
      changed: true,
      newestCreatedAt,
      etag: response.etag ?? null,
    });
  }

  async readTasks(target: string): Promise<CanonicalTask[]> {
    const snapshot = await this.boardSnapshot(CodeHostTarget.parse(target));
    return snapshot.issues
      .filter((issue) => hasTypeLabel(issue.labels))
      .map((issue) =>
        toCanonicalTask(issue, snapshot.cards.get(issue.url) ?? null),
      );
  }

  async readTask(handle: string): Promise<CanonicalTask | null> {
    const snapshot = await this.boardSnapshot(this.target);
    const issue = snapshot.issues.find((candidate) => candidate.url === handle);
    if (issue === undefined) {
      return null;
    }
    return toCanonicalTask(issue, snapshot.cards.get(issue.url) ?? null);
  }

  async createTask(
    target: string,
    task: CanonicalTask,
  ): Promise<CanonicalTask> {
    const connection = CodeHostTarget.parse(target);
    const repo = repoParts(connection.target);
    const repositoryId = await this.repoNodeId(repo);
    const labelIds = await this.labelIds(repo, task.labels);
    const board = await this.requireBoard(connection.target);
    const created = await this.graphql(CREATE_ISSUE_MUTATION, {
      repositoryId,
      title: task.title,
      body: task.body,
      labelIds,
      projectV2Ids: [board.projectNodeId],
    });
    const url = createdIssueUrl(created);
    if (task.status !== '') {
      const item = await this.boardItem(connection, url);
      if (item !== null) {
        await this.setLane(item.itemId, task.status);
      }
    }
    return new CanonicalTask({
      handle: url,
      entityId: task.entityId,
      title: task.title,
      body: task.body,
      status: task.status,
      completed: task.completed,
      parent: task.parent,
      labels: task.labels,
    });
  }

  async applyField(write: CanonicalFieldWrite): Promise<void> {
    switch (write.field) {
      case 'title':
        await this.patchIssue(write.handle, { title: write.value ?? '' });
        return;
      case 'body':
        await this.patchIssue(write.handle, { body: write.value ?? '' });
        return;
      case 'completion':
        await this.patchIssue(write.handle, {
          state: write.value === 'true' ? 'closed' : 'open',
        });
        return;
      case 'Status':
        await this.writeStatus(write);
        return;
      case 'label':
        await this.writeLabels(write);
        return;
      case 'subtasks':
        await this.writeParent(write);
        return;
    }
  }

  async deleteTask(handle: string): Promise<void> {
    const item = await this.boardItem(this.target, handle);
    if (item === null) {
      return;
    }
    const board = await this.requireBoard(this.target.target);
    await this.graphql(DELETE_BOARD_ITEM_MUTATION, {
      projectId: board.projectNodeId,
      itemId: item.itemId,
    });
  }

  async capture(target: string): Promise<CanonicalTask[]> {
    const snapshot = await this.boardSnapshot(CodeHostTarget.parse(target));
    return snapshot.issues
      .filter((issue) => hasTypeLabel(issue.labels))
      .map((issue) =>
        toCanonicalTask(issue, snapshot.cards.get(issue.url) ?? null),
      );
  }

  async captureProjects(): Promise<CapturedProject[]> {
    const data = await this.graphql(VIEWER_BOARDS_QUERY, {});
    return nodesOf(data.viewer, 'projectsV2')
      .filter(isRecord)
      .map(
        (node) =>
          new CapturedProject({
            name: typeof node.title === 'string' ? node.title : '',
            targets: repoUrlsOf(node),
            createdAt:
              typeof node.createdAt === 'string' ? node.createdAt : null,
          }),
      );
  }

  fetchComplete(): boolean {
    return true;
  }

  async fieldTime(
    handle: string,
    field: CanonicalField,
  ): Promise<string | null> {
    const snapshot = await this.boardSnapshot(this.target);
    const issue = snapshot.issues.find((candidate) => candidate.url === handle);
    if (issue === undefined) {
      return null;
    }
    return fieldTime(issue, snapshot.cards.get(issue.url) ?? null, field);
  }

  private async writeStatus(write: CanonicalFieldWrite): Promise<void> {
    if (write.value === null) {
      throw new Error('code host: cannot clear the Status lane');
    }
    const item = await this.boardItem(this.target, write.handle);
    if (item === null) {
      throw new Error(`code host: no board card for ${write.handle}`);
    }
    await this.setLane(item.itemId, write.value);
  }

  private async writeLabels(write: CanonicalFieldWrite): Promise<void> {
    const repo = repoParts(write.handle);
    const number = issueNumber(write.handle);
    const response = await this.transport.putPath(
      issueLabelsPath(repo, number),
      JSON.stringify({ labels: labelsFrom(write.value) }),
    );
    ensureSuccess(response);
  }

  private async writeParent(write: CanonicalFieldWrite): Promise<void> {
    const snapshot = await this.boardSnapshot(this.target);
    const issue = snapshot.issues.find(
      (candidate) => candidate.url === write.handle,
    );
    if (issue === undefined) {
      throw new Error(`code host: no issue for ${write.handle}`);
    }
    const parentUrl = write.value ?? issue.parentUrl;
    if (parentUrl === null) {
      return;
    }
    const parentNodeId = await this.issueNodeId(parentUrl);
    const mutation =
      write.value === null ? REMOVE_SUB_ISSUE_MUTATION : ADD_SUB_ISSUE_MUTATION;
    await this.graphql(mutation, {
      issueId: parentNodeId,
      subIssueId: issue.nodeId,
    });
  }

  private async setLane(itemId: string, status: string): Promise<void> {
    const board = await this.requireBoard(this.target.target);
    await this.graphql(SET_BOARD_STATUS_MUTATION, {
      projectId: board.projectNodeId,
      itemId,
      fieldId: board.statusFieldId,
      optionId: optionIdByName(board.statusOptions, status),
    });
  }

  private async patchIssue(
    handle: string,
    input: Record<string, string>,
  ): Promise<void> {
    const repo = repoParts(handle);
    const response = await this.transport.patch(
      issuePath(repo, issueNumber(handle)),
      JSON.stringify(input),
    );
    ensureSuccess(response);
  }

  private async issueNodeId(url: string): Promise<string> {
    const repo = repoParts(url);
    const response = await this.transport.get(
      issuePath(repo, issueNumber(url)),
    );
    if (
      response.status !== 200 ||
      !isRecord(response.json) ||
      typeof response.json.node_id !== 'string'
    ) {
      throw new Error(`code host: could not resolve issue ${url}`);
    }
    return response.json.node_id;
  }

  private async boardItem(
    connection: CodeHostTarget,
    url: string,
  ): Promise<{ itemId: string } | null> {
    const snapshot = await this.boardSnapshot(connection);
    const card = snapshot.cards.get(url);
    return card === undefined ? null : { itemId: card.itemId };
  }

  private async boardSnapshot(
    connection: CodeHostTarget,
  ): Promise<BoardSnapshot> {
    const repo = repoParts(connection.target);
    const board = await this.requireBoard(connection.target);
    const data = await this.graphql(PROJECT_DETAIL_QUERY, {
      owner: repo.owner,
      name: repo.name,
      projectId: board.projectNodeId,
    });
    const issues = nodesOf(data.repository, 'issues')
      .filter(isRecord)
      .map(parseIssue);
    const cards = new Map<string, RawCard>();
    for (const node of nodesOf(data.node, 'items')) {
      if (!isRecord(node)) {
        continue;
      }
      const card = parseCard(node);
      if (card !== null) {
        cards.set(card.issueUrl, card);
      }
    }
    return { issues, cards };
  }

  private async repoNodeId(repo: RepoParts): Promise<string> {
    const data = await this.graphql(REPO_QUERY, {
      owner: repo.owner,
      name: repo.name,
    });
    if (!isRecord(data.repository) || typeof data.repository.id !== 'string') {
      throw new Error(
        `code host: repository ${repo.owner}/${repo.name} not found`,
      );
    }
    return data.repository.id;
  }

  private async viewerId(): Promise<string> {
    const data = await this.graphql(VIEWER_QUERY, {});
    if (!isRecord(data.viewer) || typeof data.viewer.id !== 'string') {
      throw new Error('code host: viewer not found');
    }
    return data.viewer.id;
  }

  private async labelIds(
    repo: RepoParts,
    labels: readonly string[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const label of labels) {
      ids.push(await this.labelId(repo, label));
    }
    return ids;
  }

  private async labelId(repo: RepoParts, label: string): Promise<string> {
    const data = await this.graphql(LABEL_QUERY, {
      owner: repo.owner,
      name: repo.name,
      label,
    });
    if (
      isRecord(data.repository) &&
      isRecord(data.repository.label) &&
      typeof data.repository.label.id === 'string'
    ) {
      return data.repository.label.id;
    }
    const response = await this.transport.postPath(
      `/repos/${repo.owner}/${repo.name}/labels`,
      JSON.stringify({ name: label, color: LABEL_COLOR }),
    );
    if (
      (response.status !== 201 && response.status !== 200) ||
      !isRecord(response.json) ||
      typeof response.json.node_id !== 'string'
    ) {
      throw new Error(`code host: could not ensure label ${label}`);
    }
    return response.json.node_id;
  }

  private async graphql(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.transport.post(
      JSON.stringify({ query, variables }),
    );
    if (response.status !== 200) {
      throw new Error(
        `code host: GraphQL request failed with status ${response.status}`,
      );
    }
    const json = response.json;
    if (!isRecord(json) || !isRecord(json.data)) {
      throw new Error('code host: unexpected GraphQL response shape');
    }
    return json.data;
  }
}

function toCanonicalTask(issue: RawIssue, card: RawCard | null): CanonicalTask {
  return new CanonicalTask({
    handle: issue.url,
    entityId: issue.url,
    title: issue.title,
    body: issue.body,
    status: card?.statusOptionName ?? '',
    completed: issue.state === 'closed',
    parent: issue.parentUrl,
    labels: issue.labels,
  });
}

function fieldTime(
  issue: RawIssue,
  card: RawCard | null,
  field: CanonicalField,
): string | null {
  switch (field) {
    case 'title':
    case 'body':
      return issue.lastEditedAt;
    case 'Status':
      return card?.updatedAt ?? null;
    case 'completion':
    case 'label':
    case 'subtasks':
      return issue.updatedAt === '' ? null : issue.updatedAt;
  }
}

function parseIssue(node: Record<string, unknown>): RawIssue {
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
    labels: labelNames(node.labels),
    parentUrl:
      isRecord(node.parent) && typeof node.parent.url === 'string'
        ? node.parent.url
        : null,
  };
}

function parseCard(node: Record<string, unknown>): RawCard | null {
  if (typeof node.id !== 'string') {
    return null;
  }
  const content = isRecord(node.content) ? node.content : undefined;
  const issueUrl =
    content !== undefined && typeof content.url === 'string'
      ? content.url
      : undefined;
  if (issueUrl === undefined) {
    return null;
  }
  return {
    itemId: node.id,
    issueUrl,
    statusOptionName: statusOptionName(node.fieldValues),
    updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : null,
  };
}

function statusOptionName(fieldValues: unknown): string | undefined {
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

function labelNames(labels: unknown): readonly string[] {
  if (!isRecord(labels) || !Array.isArray(labels.nodes)) {
    return [];
  }
  return labels.nodes
    .filter(isRecord)
    .flatMap((label) => (typeof label.name === 'string' ? [label.name] : []));
}

function nodesOf(container: unknown, key: string): unknown[] {
  if (!isRecord(container)) {
    return [];
  }
  const inner = container[key];
  if (!isRecord(inner) || !Array.isArray(inner.nodes)) {
    return [];
  }
  return inner.nodes;
}

function repoUrlsOf(node: Record<string, unknown>): readonly string[] {
  return nodesOf(node, 'repositories')
    .filter(isRecord)
    .flatMap((repository) =>
      typeof repository.url === 'string' && repository.url !== ''
        ? [repository.url]
        : [],
    );
}

function parseRepoBoard(node: Record<string, unknown>): RepoBoard[] {
  if (typeof node.id !== 'string') {
    return [];
  }
  return [
    {
      projectNodeId: node.id,
      name: typeof node.title === 'string' ? node.title : '',
    },
  ];
}

function chooseBoard(
  targetName: string,
  boards: readonly RepoBoard[],
): RepoBoard | null {
  if (boards.length === 0) {
    return null;
  }
  if (boards.length === 1) {
    return boards[0]!;
  }
  const match = boards.find((board) => board.name === targetName);
  if (match === undefined) {
    throw new Error(
      `code host: repository ${targetName} has several boards and none is titled "${targetName}"`,
    );
  }
  return match;
}

function statusField(project: unknown): StatusField | null {
  if (
    !isRecord(project) ||
    !isRecord(project.fields) ||
    !Array.isArray(project.fields.nodes)
  ) {
    return null;
  }
  for (const node of project.fields.nodes) {
    if (
      !isRecord(node) ||
      node.name !== 'Status' ||
      typeof node.id !== 'string'
    ) {
      continue;
    }
    return { id: node.id, options: statusOptionsOf(node.options) };
  }
  return null;
}

function statusOptionsOf(options: unknown): readonly StatusOption[] {
  if (!Array.isArray(options)) {
    return [];
  }
  return options
    .filter(isRecord)
    .filter(
      (option): option is { id: string; name: string } =>
        typeof option.id === 'string' && typeof option.name === 'string',
    )
    .map((option) => ({ id: option.id, name: option.name }));
}

function createdStatusField(
  created: Record<string, unknown>,
): StatusField | null {
  const payload = created.createProjectV2Field;
  const node = isRecord(payload) ? payload.projectV2Field : undefined;
  if (!isRecord(node) || typeof node.id !== 'string') {
    return null;
  }
  return { id: node.id, options: statusOptionsOf(node.options) };
}

function createdProjectId(created: Record<string, unknown>): string {
  const project = isRecord(created.createProjectV2)
    ? created.createProjectV2.projectV2
    : undefined;
  if (!isRecord(project) || typeof project.id !== 'string') {
    throw new Error('code host: create board returned no project');
  }
  return project.id;
}

function createdIssueUrl(created: Record<string, unknown>): string {
  const issue = isRecord(created.createIssue)
    ? created.createIssue.issue
    : undefined;
  if (!isRecord(issue) || typeof issue.url !== 'string' || issue.url === '') {
    throw new Error('code host: create issue returned no url');
  }
  return issue.url;
}

function hasTypeLabel(labels: readonly string[]): boolean {
  return labels.some((label) => label.startsWith('type:'));
}

function labelsFrom(value: string | null): readonly string[] {
  if (value === null || value === '') {
    return [];
  }
  return value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '');
}

function optionIdByName(
  options: readonly StatusOption[],
  name: string,
): string {
  const option = options.find((candidate) => candidate.name === name);
  if (option === undefined) {
    throw new Error(`code host: no status option named "${name}"`);
  }
  return option.id;
}

function repoParts(url: string): RepoParts {
  const normalized = url.includes('://') ? url : `https://github.com/${url}`;
  const segments = pathSegments(normalized);
  const owner = segments[0];
  const name = segments[1];
  if (owner === undefined || name === undefined) {
    throw new Error(`code host: invalid repository url ${url}`);
  }
  return { owner, name };
}

function issueNumber(handle: string): number {
  const segments = pathSegments(handle);
  const number = Number(segments[segments.length - 1]);
  if (!Number.isInteger(number)) {
    throw new Error(`code host: invalid issue url ${handle}`);
  }
  return number;
}

function issuePath(repo: RepoParts, number: number): string {
  return `/repos/${repo.owner}/${repo.name}/issues/${number}`;
}

function issueLabelsPath(repo: RepoParts, number: number): string {
  return `${issuePath(repo, number)}/labels`;
}

function pathSegments(url: string): string[] {
  return new URL(url).pathname
    .split('/')
    .filter((segment) => segment.length > 0);
}

function ensureSuccess(response: CodeHostResponse): void {
  if (response.status !== 200) {
    throw new Error(
      `code host: REST request failed with status ${response.status}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
