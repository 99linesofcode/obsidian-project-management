import type { CanonicalField } from '../../core/domain/canonicalField.js';
import { isRecord } from '../../core/domain/isRecord.js';
import {
  hasTypeLabel,
  labelsFromSequence,
} from '../../core/domain/note.js';
import type { CanonicalFieldWrite } from '../../core/port/data/CanonicalFieldWrite.js';
import { CanonicalProject } from '../../core/port/data/CanonicalProject.js';
import { CanonicalTask } from '../../core/port/data/CanonicalTask.js';
import { ProjectAddressing } from '../../core/port/data/ProjectAddressing.js';
import type { ProjectIdentityDataTransferObject } from '../../core/port/data/ProjectIdentityDataTransferObject.js';
import type { MirrorPort } from '../../core/port/MirrorPort.js';
import type {
  GithubResponse,
  GithubTransport,
} from './GithubTransport.js';
import { GithubTarget } from './GithubTarget.js';
import {
  ADD_SUB_ISSUE_MUTATION,
  CREATE_BOARD_MUTATION,
  CREATE_ISSUE_MUTATION,
  CREATE_STATUS_FIELD_MUTATION,
  DELETE_BOARD_ITEM_MUTATION,
  DELETE_ISSUE_MUTATION,
  LABEL_QUERY,
  LINK_BOARD_MUTATION,
  LOCK_TASK_MUTATION,
  PROJECT_CONTENT_QUERY,
  PROJECT_DETAIL_QUERY,
  PROJECT_FIELDS_QUERY,
  REMOVE_SUB_ISSUE_MUTATION,
  RENAME_PROJECT_MUTATION,
  REPO_BOARDS_QUERY,
  REPO_QUERY,
  SET_BOARD_STATUS_MUTATION,
  SET_PROJECT_CLOSED_MUTATION,
  UNLOCK_TASK_MUTATION,
  VIEWER_BOARDS_QUERY,
  VIEWER_QUERY,
} from './githubDocuments.js';
import { fieldTime, toCanonicalTask } from './githubTaskMapper.js';
import {
  chooseBoard,
  createdIssueUrl,
  createdProjectId,
  createdStatusField,
  issueLabelsPath,
  issueNumber,
  issuePath,
  nodesOf,
  optionIdByName,
  parseCard,
  parseIssue,
  parseRepoBoard,
  repoParts,
  statusField,
  type BoardIdentity,
  type BoardSnapshot,
  type RawCard,
  type RepoParts,
  type StatusField,
} from './githubWire.js';

const LABEL_COLOR = 'cccccc';

export class GithubMirrorAdapter implements MirrorPort {
  private readonly rawTarget: string;
  private readonly boards = new Map<string, Promise<BoardIdentity | null>>();

  constructor(
    private readonly transport: GithubTransport,
    target = '',
    private readonly boardIdentity?: () => Promise<ProjectIdentityDataTransferObject | null>,
  ) {
    this.rawTarget = target;
  }

  private get target(): GithubTarget {
    return GithubTarget.parse(this.rawTarget);
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
    const connection = GithubTarget.parse(target);
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

  private async provisionBoard(
    name: string,
    repositoryId: string,
    statusOptions: readonly string[],
  ): Promise<{ projectId: string; status: StatusField }> {
    const projectId =
      (await this.findOrphanBoard(name)) ?? (await this.createBoard(name));
    await this.linkBoard(projectId, repositoryId);
    const status = await this.ensureStatusField(projectId, statusOptions);
    return { projectId, status };
  }

  private async linkBoard(
    projectId: string,
    repositoryId: string,
  ): Promise<void> {
    await this.graphql(LINK_BOARD_MUTATION, { projectId, repositoryId });
  }

  private addressing(
    projectHandle: string,
    status: StatusField,
    effectiveTarget: string,
  ): ProjectAddressing {
    return new ProjectAddressing({
      projectHandle,
      statusFieldHandle: status.id,
      statusOptions: status.options,
      effectiveTarget,
    });
  }

  async setArchived(target: string, archived: boolean): Promise<void> {
    const connection = GithubTarget.parse(target);
    const board = await this.requireBoard(connection.target);
    await this.graphql(SET_PROJECT_CLOSED_MUTATION, {
      projectId: board.projectNodeId,
      closed: archived,
    });
  }

  async renameProject(target: string, name: string): Promise<void> {
    const connection = GithubTarget.parse(target);
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

  async projectTime(target: string): Promise<string | null> {
    const connection = GithubTarget.parse(target);
    const board = await this.board(connection.target);
    if (board === null) {
      return null;
    }
    const data = await this.graphql(PROJECT_CONTENT_QUERY, {
      projectId: board.projectNodeId,
    });
    const project = data.node;
    if (!isRecord(project)) {
      return null;
    }
    return typeof project.closedAt === 'string' ? project.closedAt : null;
  }

  async resolveOrCreateProject(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing | null> {
    const connection = GithubTarget.parse(target);
    const repoUrl =
      connection.target === ''
        ? await this.viewerRepoUrl(name)
        : connection.target;
    const repositoryId = await this.repoIdOrNull(repoParts(repoUrl));
    if (repositoryId === null) {
      console.error(
        `code host: repository ${repoUrl} not found; leaving the connection unoriginated`,
      );
      return null;
    }
    const existing = await this.findBoardByName(repoUrl, name);
    if (existing !== null) {
      await this.linkBoard(existing, repositoryId);
      const status = await this.ensureStatusField(existing, statusOptions);
      return this.addressing(existing, status, repoUrl);
    }
    const { projectId, status } = await this.provisionBoard(
      name,
      repositoryId,
      statusOptions,
    );
    return this.addressing(projectId, status, repoUrl);
  }

  private async viewerRepoUrl(name: string): Promise<string> {
    const owner = await this.viewerLogin();
    return `https://github.com/${owner}/${name}`;
  }

  private async repoIdOrNull(repo: RepoParts): Promise<string | null> {
    const data = await this.graphql(REPO_QUERY, {
      owner: repo.owner,
      name: repo.name,
    });
    return isRecord(data.repository) && typeof data.repository.id === 'string'
      ? data.repository.id
      : null;
  }

  private async viewerLogin(): Promise<string> {
    const data = await this.graphql(VIEWER_QUERY, {});
    if (!isRecord(data.viewer) || typeof data.viewer.login !== 'string') {
      throw new Error('code host: viewer login not found');
    }
    return data.viewer.login;
  }

  private async findBoardByName(
    target: string,
    name: string,
  ): Promise<string | null> {
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
    const board = nodesOf(repository, 'projectsV2')
      .filter(isRecord)
      .flatMap(parseRepoBoard)
      .find((candidate) => candidate.name === name);
    return board?.projectNodeId ?? null;
  }

  async readTasks(target: string): Promise<CanonicalTask[]> {
    const snapshot = await this.boardSnapshot(GithubTarget.parse(target));
    return snapshot.issues
      .filter((issue) => hasTypeLabel(issue.labels))
      .map((issue) =>
        toCanonicalTask(issue, snapshot.cards.get(issue.url) ?? null),
      );
  }

  async readTask(handle: string): Promise<CanonicalTask | null> {
    const snapshot = await this.boardSnapshot(this.target);
    const issue = snapshot.issues.find((candidate) => candidate.url === handle);
    if (issue === undefined || !hasTypeLabel(issue.labels)) {
      return null;
    }
    return toCanonicalTask(issue, snapshot.cards.get(issue.url) ?? null);
  }

  async createTask(
    target: string,
    task: CanonicalTask,
  ): Promise<CanonicalTask> {
    const connection = GithubTarget.parse(target);
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
    const snapshot = await this.boardSnapshot(this.target);
    const card = snapshot.cards.get(handle);
    const issue = snapshot.issues.find((candidate) => candidate.url === handle);

    if (card !== undefined) {
      const board = await this.requireBoard(this.target.target);
      await this.graphql(DELETE_BOARD_ITEM_MUTATION, {
        projectId: board.projectNodeId,
        itemId: card.itemId,
      });
    }

    if (issue === undefined || issue.nodeId === '') {
      return;
    }
    try {
      await this.graphql(DELETE_ISSUE_MUTATION, { issueId: issue.nodeId });
    } catch (error) {
      console.error(`code host: deleting issue ${handle} failed`, error);
      throw error;
    }
  }

  async capture(target: string): Promise<CanonicalTask[]> {
    const snapshot = await this.boardSnapshot(GithubTarget.parse(target));
    return snapshot.issues
      .filter((issue) => hasTypeLabel(issue.labels))
      .map((issue) =>
        toCanonicalTask(issue, snapshot.cards.get(issue.url) ?? null),
      );
  }

  materializesTodo(): boolean {
    return false;
  }

  taskHandlesAreUrls(): boolean {
    return true;
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
      JSON.stringify({ labels: labelsFromSequence(write.value) }),
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
    connection: GithubTarget,
    url: string,
  ): Promise<{ itemId: string } | null> {
    const snapshot = await this.boardSnapshot(connection);
    const card = snapshot.cards.get(url);
    return card === undefined ? null : { itemId: card.itemId };
  }

  private async boardSnapshot(
    connection: GithubTarget,
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

function ensureSuccess(response: GithubResponse): void {
  if (response.status !== 200) {
    throw new Error(
      `code host: REST request failed with status ${response.status}`,
    );
  }
}
