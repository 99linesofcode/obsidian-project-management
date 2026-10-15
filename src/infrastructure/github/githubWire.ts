import { isRecord } from '../../core/domain/isRecord.js';
import type { StatusOption } from './GithubTarget.js';

export interface RepoParts {
  owner: string;
  name: string;
}

export interface BoardIdentity {
  readonly projectNodeId: string;
  readonly statusFieldId: string;
  readonly statusOptions: readonly StatusOption[];
}

export interface RepoBoard {
  projectNodeId: string;
  name: string;
}

export interface StatusField {
  id: string;
  options: readonly StatusOption[];
}

export interface RawIssue {
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

export interface RawCard {
  itemId: string;
  issueUrl: string;
  statusOptionName: string | undefined;
  updatedAt: string | null;
}

export interface BoardSnapshot {
  issues: RawIssue[];
  cards: Map<string, RawCard>;
}

export function parseIssue(node: Record<string, unknown>): RawIssue {
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

export function parseCard(node: Record<string, unknown>): RawCard | null {
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

export function nodesOf(container: unknown, key: string): unknown[] {
  if (!isRecord(container)) {
    return [];
  }
  const inner = container[key];
  if (!isRecord(inner) || !Array.isArray(inner.nodes)) {
    return [];
  }
  return inner.nodes;
}

export function parseRepoBoard(node: Record<string, unknown>): RepoBoard[] {
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

export function chooseBoard(
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

export function statusField(project: unknown): StatusField | null {
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

export function createdStatusField(
  created: Record<string, unknown>,
): StatusField | null {
  const payload = created.createProjectV2Field;
  const node = isRecord(payload) ? payload.projectV2Field : undefined;
  if (!isRecord(node) || typeof node.id !== 'string') {
    return null;
  }
  return { id: node.id, options: statusOptionsOf(node.options) };
}

export function createdProjectId(created: Record<string, unknown>): string {
  const project = isRecord(created.createProjectV2)
    ? created.createProjectV2.projectV2
    : undefined;
  if (!isRecord(project) || typeof project.id !== 'string') {
    throw new Error('code host: create board returned no project');
  }
  return project.id;
}

export function createdIssueUrl(created: Record<string, unknown>): string {
  const issue = isRecord(created.createIssue)
    ? created.createIssue.issue
    : undefined;
  if (!isRecord(issue) || typeof issue.url !== 'string' || issue.url === '') {
    throw new Error('code host: create issue returned no url');
  }
  return issue.url;
}

export function optionIdByName(
  options: readonly StatusOption[],
  name: string,
): string {
  const option = options.find((candidate) => candidate.name === name);
  if (option === undefined) {
    throw new Error(`code host: no status option named "${name}"`);
  }
  return option.id;
}

export function repoParts(url: string): RepoParts {
  const normalized = url.includes('://') ? url : `https://github.com/${url}`;
  const segments = pathSegments(normalized);
  const owner = segments[0];
  const name = segments[1];
  if (owner === undefined || name === undefined) {
    throw new Error(`code host: invalid repository url ${url}`);
  }
  return { owner, name };
}

export function issueNumber(handle: string): number {
  const segments = pathSegments(handle);
  const number = Number(segments[segments.length - 1]);
  if (!Number.isInteger(number)) {
    throw new Error(`code host: invalid issue url ${handle}`);
  }
  return number;
}

export function issuePath(repo: RepoParts, number: number): string {
  return `/repos/${repo.owner}/${repo.name}/issues/${number}`;
}

export function issueLabelsPath(repo: RepoParts, number: number): string {
  return `${issuePath(repo, number)}/labels`;
}

function pathSegments(url: string): string[] {
  return new URL(url).pathname
    .split('/')
    .filter((segment) => segment.length > 0);
}
