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

// The capture's outcome: the names of the projects it created (so the caller can
// enqueue them without waiting for a metadata-cache refresh) and the errors it
// collected. A board that is not capturable under the repo-only model is
// collected here rather than skipped silently.
export interface CaptureResult {
  captured: string[];
  errors: unknown[];
}

// The linked vault projects the capture must not adopt: their names, the
// todoist project ids and the code-host repository urls their connections
// carry. A remote project matching any of these already has a vault home, so
// adopting it would create a duplicate.
interface VaultLinks {
  names: Set<string>;
  todoistIds: Set<string>;
  repoUrls: Set<string>;
}

// UC: capture remote-born projects into the vault (PRJ-2 task manager -> vault,
// PRJ-3 code host -> vault). The vault is the splice: a project born on either
// remote gains a `Projecten/<name>/` folder, a `_<name>.md` home note declaring
// the captured connection, and a registry identity record. The normal lifecycle
// then syncs the declared connection.
//
// Scope guard (critical): only a project CREATED AFTER the last poll is
// captured. Each surface keeps its own cursor (the newest provider creation
// clock seen at the previous poll); a project at or before the cursor is
// pre-existing and is NEVER adopted. A first sight (no cursor) adopts the
// current newest clock and captures nothing, so installing the plugin against
// an account full of unrelated projects adopts none of them. A provider record
// with no creation clock is treated as not-new (skipped) rather than guessed.
//
// The cursor is a WATERMARK over the processed range, not over the listing: it
// advances only over projects that were actually handled, in creation order. A
// post-cursor project that could not be captured (an unresolvable board
// identity, a board without exactly one linked repository, a home note the
// discovery scan did not see) stops the watermark so the next pass retries it —
// a failed capture is never skipped past. A project already linked to a vault
// home is handled and the watermark may pass it.
//
// The action is idempotent: a captured project's home note is linked by name
// and connection, so a second pass skips it even before the cursor has advanced.
export class CaptureRemoteProjectsAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly doneOptionName: string,
  ) {}

  // Captures both surfaces and returns the projects it created plus any errors,
  // so the caller can enqueue the created ones and surface the rest.
  async execute(input: CaptureRemoteProjectsInput): Promise<CaptureResult> {
    const taskManager = await this.captureTaskManagerProjects(input.syncedAt);
    const codeHost = await this.captureCodeHostProjects(input.syncedAt);
    return {
      captured: [...taskManager.captured, ...codeHost.captured],
      errors: [...taskManager.errors, ...codeHost.errors],
    };
  }

  // PRJ-2: a task-manager project created by hand. Task-manager projects come
  // from the task-manager port as provider DTOs, so the boundary mapping
  // happens here (ProjectMapper.fromRemoteProject) before the core touches the
  // payload.
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
      // First sight: adopt the current newest clock and capture nothing.
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
        // Already linked to a vault home: handled, so the watermark may pass it.
        nextCursor = project.createdAt ?? nextCursor;
        continue;
      }
      const created = await this.materializeVaultProject(
        project.name,
        todoistConnection(payload.id),
        emptyIdentity(),
      );
      if (!created) {
        // A home note the discovery scan did not see. Leave the watermark here
        // so the next pass retries it; a later project is retried too.
        break;
      }
      captured.push(project.name);
      nextCursor = project.createdAt ?? nextCursor;
    }
    await this.advanceCursor('todoist', nextCursor, cursor);
    return { captured, errors: [] };
  }

  // PRJ-3: a board created on the code host by hand. The port already mapped
  // the listing onto canonical ProjectData (ProjectMapper.fromCodeHostBoard
  // inside the adapter), so the core reasons only about ProjectData; the
  // board's linked repositories ride alongside. Under the repo-only connection
  // model a board is capturable only through exactly one linked repository: the
  // capture derives the github connection's project from it and collects an
  // error when the link is empty or ambiguous.
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
        // Nothing to capture (no anchor) or already linked: handled.
        nextCursor = board.createdAt ?? nextCursor;
        continue;
      }
      if (entry.repoUrls.length !== 1) {
        // A board is capturable only through exactly one repository. Zero or
        // several links are a configuration error, not a guess: collect it and
        // stop the watermark so the next pass retries once the user fixes it.
        errors.push(
          new Error(
            `board "${board.name}" (${boardUrl}) links ${entry.repoUrls.length} repositories; a board is captured through exactly one repository`,
          ),
        );
        break;
      }
      const repoUrl = entry.repoUrls[0]!;
      if (links.repoUrls.has(repoUrl)) {
        // The repository already has a vault home: handled.
        nextCursor = board.createdAt ?? nextCursor;
        continue;
      }
      const identity = await this.projectManagement.fetchProjectIdentity({
        pm: 'github',
        repoUrl,
        boardUrl,
      });
      if (identity === null) {
        // The board could not be resolved to an identity. Leave the watermark
        // here so the next pass retries it rather than skipping the board.
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

  // The vault project the capture materializes: a folder + home note (the
  // splice), plus the registry identity. The home note is never overwritten —
  // an existing project of the same name wins, and the remote project is left
  // unadopted (the lifecycle links it by name on the next pass). Returns whether
  // the project was actually created: false means the home note already existed,
  // so the caller must not count it as captured nor advance past it.
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
    await this.syncState.setIdentity(name, identity);
    return true;
  }

  // The home note's content: the connection envelope the captured surface
  // declared. A task-manager-born project carries a todoist connection; a
  // board-born project carries the github connection its linked repository
  // resolved to. The legacy top-level properties are never written.
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

  // Advances a surface cursor only when it actually moved. WHY the guard at the
  // call site in addition to the adapter's: the capture runs every tick, and a
  // quiet tick must perform zero registry writes (SYNC-8). A first sight
  // (previous null) always writes.
  private async advanceCursor(
    portId: string,
    next: string,
    previous: string | null,
  ): Promise<void> {
    if (previous === null || next !== previous) {
      await this.syncState.setProjectCursor(portId, next);
    }
  }

  // The already-linked vault projects, read from the discovered home notes'
  // connections map. The registry has no "list every project" read, and the
  // note's declared connections are the vault-side truth for linking, so the
  // scan is the authoritative dedup source.
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

// The github connection a captured repository declares, under the default
// connection slug.
function githubConnection(repoUrl: string): Record<string, ConnectionData> {
  return { github: { tool: 'github', project: repoUrl } };
}

// The todoist connection a captured task-manager project declares, under the
// default connection slug.
function todoistConnection(projectId: string): Record<string, ConnectionData> {
  return { todoist: { tool: 'todoist', project: projectId } };
}

// The identity of a vault project whose board has not been created yet: the
// capture records the project so the lifecycle's board leg (PRJ-1) can fill in
// the addressing on the next pass.
function emptyIdentity(): ProjectIdentityData {
  return new ProjectIdentityData({
    repoUrl: '',
    repoNodeId: '',
    projectNodeId: '',
    statusFieldId: '',
    statusOptions: [],
  });
}

// The newest provider creation clock among a listing, or null when none carry
// one. ISO strings sort lexicographically, so a plain max is correct.
function newestCreatedAt(clocks: Array<string | null | undefined>): string | null {
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

// Creation order, oldest first, records with no clock last. The capture walks
// this order so the cursor watermark stops at the first project it could not
// handle.
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

// Whether a project was created strictly after the cursor. A null clock is
// never new: the cursor must not guess, and adopting an unknown-age project
// could violate the never-adopt-preexisting guard.
function createdAfter(createdAt: string | null, cursor: string): boolean {
  return createdAt !== null && createdAt > cursor;
}
