import { ProjectMapper } from './ProjectMapper.js';
import { projectHomePath } from '../shared/projectHomePath.js';
import { renderConnectionsBlock } from '../vault/renderConnectionsBlock.js';
import type { ConnectionData } from '../shared/ConnectionData.js';
import { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { RemoteBoardData } from '../shared/RemoteBoardData.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskManagerPort } from '../shared/TaskManagerPort.js';
import type { VaultPort } from '../shared/VaultPort.js';

export interface CaptureRemoteProjectsInput {
  syncedAt: string;
}

export interface CaptureResult {
  captured: string[];
  errors: unknown[];
}

interface VaultLinks {
  names: Set<string>;
  todoistIds: Set<string>;
  repoUrls: Set<string>;
}

export class CaptureRemoteProjectsAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: CaptureRemoteProjectsInput): Promise<CaptureResult> {
    const taskManager = await this.captureTaskManagerProjects(input.syncedAt);
    const codeHost = await this.captureCodeHostProjects(input.syncedAt);
    return {
      captured: [...taskManager.captured, ...codeHost.captured],
      errors: [...taskManager.errors, ...codeHost.errors],
    };
  }

  private async captureTaskManagerProjects(
    syncedAt: string,
  ): Promise<CaptureResult> {
    const projects = await this.taskManager.fetchProjects();
    const links = await this.vaultLinks();
    const cursor = await this.syncState.getProjectCursor('todoist');
    const newest = newestCreatedAt(
      projects.map((project) => project.createdAt),
    );

    if (cursor === null) {
      await this.advanceCursor('todoist', newest ?? syncedAt, null);
      return { captured: [], errors: [] };
    }

    const captured: string[] = [];
    let nextCursor = cursor;
    for (const payload of sortedByCreatedAt(
      projects,
      (project) => project.createdAt,
    )) {
      const project = ProjectMapper.fromRemoteProject(payload, {
        path: '',
        doneLane: this.doneOptionName,
        archivedAt: null,
        repoUrl: '',
      });
      if (!createdAfter(project.createdAt, cursor)) {
        continue;
      }
      if (links.todoistIds.has(payload.id) || links.names.has(project.name)) {
        nextCursor = project.createdAt ?? nextCursor;
        continue;
      }
      const created = await this.materializeVaultProject(
        project.name,
        todoistConnection(payload.id),
        emptyIdentity(),
      );
      if (!created) {
        break;
      }
      captured.push(project.name);
      nextCursor = project.createdAt ?? nextCursor;
    }
    await this.advanceCursor('todoist', nextCursor, cursor);
    return { captured, errors: [] };
  }

  private async captureCodeHostProjects(
    syncedAt: string,
  ): Promise<CaptureResult> {
    const boards: RemoteBoardData[] =
      await this.projectManagement.fetchViewerProjects();
    const links = await this.vaultLinks();
    const cursor = await this.syncState.getProjectCursor('github');
    const newest = newestCreatedAt(
      boards.map((board) => board.project.createdAt),
    );

    if (cursor === null) {
      await this.advanceCursor('github', newest ?? syncedAt, null);
      return { captured: [], errors: [] };
    }

    const captured: string[] = [];
    const errors: unknown[] = [];
    let nextCursor = cursor;
    for (const entry of sortedByCreatedAt(
      boards,
      (board) => board.project.createdAt,
    )) {
      const board = entry.project;
      if (!createdAfter(board.createdAt, cursor)) {
        continue;
      }
      const boardUrl = board.mirrors.github ?? '';
      if (boardUrl === '' || links.names.has(board.name)) {
        nextCursor = board.createdAt ?? nextCursor;
        continue;
      }
      if (entry.repoUrls.length !== 1) {
        errors.push(
          new Error(
            `board "${board.name}" (${boardUrl}) links ${entry.repoUrls.length} repositories; a board is captured through exactly one repository`,
          ),
        );
        break;
      }
      const repoUrl = entry.repoUrls[0]!;
      if (links.repoUrls.has(repoUrl)) {
        nextCursor = board.createdAt ?? nextCursor;
        continue;
      }
      const identity = await this.projectManagement.fetchProjectIdentity({
        repoUrl,
        boardUrl,
      });
      if (identity === null) {
        break;
      }
      const created = await this.materializeVaultProject(
        board.name,
        githubConnection(repoUrl),
        identity,
      );
      if (!created) {
        break;
      }
      captured.push(board.name);
      nextCursor = board.createdAt ?? nextCursor;
    }
    await this.advanceCursor('github', nextCursor, cursor);
    return { captured, errors };
  }

  private async materializeVaultProject(
    name: string,
    connections: Record<string, ConnectionData>,
    identity: ProjectIdentityData,
  ): Promise<boolean> {
    const homePath = projectHomePath(name, false);
    if ((await this.vault.getNoteByPath(homePath)) !== null) {
      return false;
    }
    await this.vault.createNote(
      homePath,
      this.homeNoteContent(name, connections),
    );
    const slug = Object.keys(connections)[0];
    if (slug !== undefined) {
      await this.syncState.setIdentity(name, slug, identity);
    }
    return true;
  }

  private homeNoteContent(
    name: string,
    connections: Record<string, ConnectionData>,
  ): string {
    return [
      '---',
      ...renderConnectionsBlock(connections),
      '---',
      '',
      `# ${name}`,
      '',
    ].join('\n');
  }

  private async advanceCursor(
    portId: string,
    next: string,
    previous: string | null,
  ): Promise<void> {
    if (previous === null || next !== previous) {
      await this.syncState.setProjectCursor(portId, next);
    }
  }

  private async vaultLinks(): Promise<VaultLinks> {
    const names = new Set<string>();
    const todoistIds = new Set<string>();
    const repoUrls = new Set<string>();
    for (const note of await this.vault.findProjectNotes()) {
      names.add(note.projectName);
      for (const connection of Object.values(note.connections)) {
        if (connection.project === '') {
          continue;
        }
        if (connection.tool === 'todoist') {
          todoistIds.add(connection.project);
        } else if (connection.tool === 'github') {
          repoUrls.add(connection.project);
        }
      }
    }
    return { names, todoistIds, repoUrls };
  }
}

function githubConnection(repoUrl: string): Record<string, ConnectionData> {
  return { github: { tool: 'github', project: repoUrl } };
}

function todoistConnection(projectId: string): Record<string, ConnectionData> {
  return { todoist: { tool: 'todoist', project: projectId } };
}

function emptyIdentity(): ProjectIdentityData {
  return new ProjectIdentityData({
    repoUrl: '',
    repoNodeId: '',
    projectNodeId: '',
    statusFieldId: '',
    statusOptions: [],
  });
}

function newestCreatedAt(
  clocks: Array<string | null | undefined>,
): string | null {
  let newest: string | null = null;
  for (const clock of clocks) {
    if (clock === null || clock === undefined) {
      continue;
    }
    if (newest === null || clock > newest) {
      newest = clock;
    }
  }
  return newest;
}

function sortedByCreatedAt<T>(
  items: T[],
  createdAt: (item: T) => string | null | undefined,
): T[] {
  return [...items].sort((a, b) => {
    const left = createdAt(a);
    const right = createdAt(b);
    if (left === null || left === undefined) {
      return 1;
    }
    if (right === null || right === undefined) {
      return -1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function createdAfter(createdAt: string | null, cursor: string): boolean {
  return createdAt !== null && createdAt > cursor;
}
