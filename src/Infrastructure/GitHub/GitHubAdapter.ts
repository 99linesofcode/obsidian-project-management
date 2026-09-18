import type { AttachProjectData } from '../../Domain/DataTransferObjects/AttachProjectData.js';
import type {
  ProjectIdentityData,
  ProjectStatusOption,
} from '../../Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../Domain/Ports/ProjectManagementPort.js';

// The transport the adapter talks through, injected so tests can fake it.
// Production wiring (the real requestUrl) lands in a later ticket.
export type Post = (body: string) => Promise<{ status: number; json: unknown }>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Implements the project management port against GitHub's GraphQL API.
// Maps raw responses onto the identity DTO; the core never sees GitHub JSON.
export class GitHubAdapter implements ProjectManagementPort {
  constructor(private readonly post: Post) {}

  async fetchProjectIdentity(data: AttachProjectData): Promise<ProjectIdentityData | null> {
    const repo = this.parseRepoUrl(data.repoUrl);
    const board = this.parseBoardUrl(data.boardUrl);

    const repoNodeId = await this.fetchRepoNodeId(repo);
    const project = await this.fetchProject(board);

    return {
      repoNodeId,
      projectNodeId: project.id,
      statusFieldId: project.statusFieldId,
      statusOptions: project.statusOptions,
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
    const response = await this.post(JSON.stringify({ query, variables }));
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
    const path = this.pathSegments(url);
    if (path.length < 2) {
      throw new Error(`GitHubAdapter: invalid repo url ${url}`);
    }
    return { owner: path[0]!, name: path[1]! };
  }

  private parseBoardUrl(url: string): BoardParts {
    const path = this.pathSegments(url);
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
