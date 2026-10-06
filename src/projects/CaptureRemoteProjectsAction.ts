import { ProjectMapper } from './ProjectMapper.js';
import { projectHomePath } from '../shared/projectHomePath.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import type { ProjectData } from '../shared/ProjectData.js';
import type { ProjectIdentityData } from './ProjectIdentityData.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskManagerPort } from '../shared/TaskManagerPort.js';
import type { VaultPort } from '../shared/VaultPort.js';

export interface CaptureRemoteProjectsInput {
  syncedAt: string;
}

// The linked vault projects the capture must not adopt: their names, the
// todoist anchors and the board urls their home notes carry. A remote project
// matching any of these already has a vault home, so adopting it would create
// a duplicate.
interface VaultLinks {
  names: Set<string>;
  todoistIds: Set<string>;
  boardUrls: Set<string>;
}

// UC: capture remote-born projects into the vault (PRJ-2 task manager -> vault,
// PRJ-3 code host -> vault). The vault is the splice: a project born on either
// remote gains a `Projecten/<name>/` folder, a `_<name>.md` home note carrying
// the anchor(s), and a registry identity record. The normal lifecycle then
// materializes the other surfaces (the board for a task-manager-born project,
// the task-manager project for a board-born one).
//
// Scope guard (critical): only a project CREATED AFTER the last poll is
// captured. Each surface keeps its own cursor (the newest provider creation
// clock seen at the previous poll); a project at or before the cursor is
// pre-existing and is NEVER adopted. A first sight (no cursor) adopts the
// current newest clock and captures nothing, so installing the plugin against
// an account full of unrelated projects adopts none of them. A provider record
// with no creation clock is treated as not-new (skipped) rather than guessed.
//
// The action is idempotent: a captured project's home note is linked by name
// and anchor, so a second pass skips it even before the cursor has advanced.
export class CaptureRemoteProjectsAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly doneOptionName: string,
  ) {}

  // Captures both surfaces and returns the names of the projects it created,
  // so the caller can enqueue them for the normal chain without waiting for a
  // metadata-cache refresh.
  async execute(input: CaptureRemoteProjectsInput): Promise<string[]> {
    const captured: string[] = [];
    captured.push(...(await this.captureTaskManagerProjects(input.syncedAt)));
    captured.push(...(await this.captureCodeHostProjects(input.syncedAt)));
    return captured;
  }

  // PRJ-2: a task-manager project created by hand. Task-manager projects come
  // from the task-manager port as provider DTOs, so the boundary mapping
  // happens here (ProjectMapper.fromRemoteProject) before the core touches the
  // payload.
  private async captureTaskManagerProjects(syncedAt: string): Promise<string[]> {
    const projects = await this.taskManager.fetchProjects();
    const links = await this.vaultLinks();
    const cursor = await this.syncState.getProjectCursor('todoist');
    const newest = newestCreatedAt(projects.map((project) => project.createdAt));

    if (cursor === null) {
      // First sight: adopt the current newest clock and capture nothing.
      await this.syncState.setProjectCursor('todoist', newest ?? syncedAt);
      return [];
    }

    const captured: string[] = [];
    for (const payload of projects) {
      const project = ProjectMapper.fromRemoteProject(payload, {
        path: '',
        doneLane: this.doneOptionName,
        archivedAt: null,
        repoUrl: '',
      });
      if (!createdAfter(project.createdAt, cursor)) {
        continue;
      }
      if (
        links.todoistIds.has(payload.id) ||
        links.names.has(project.name)
      ) {
        continue;
      }
      await this.materializeVaultProject(project.name, {
        todoistId: payload.id,
        boardUrl: '',
        identity: emptyIdentity(),
      });
      captured.push(project.name);
    }
    await this.syncState.setProjectCursor('todoist', newest ?? cursor);
    return captured;
  }

  // PRJ-3: a board created on the code host by hand. The port already mapped
  // the listing onto canonical ProjectData (ProjectMapper.fromCodeHostBoard
  // inside the adapter), so the core reasons only about ProjectData; the
  // identity (node id + Status addressing) is resolved through the board-only
  // attach.
  private async captureCodeHostProjects(syncedAt: string): Promise<string[]> {
    const boards: ProjectData[] =
      await this.projectManagement.fetchViewerProjects();
    const links = await this.vaultLinks();
    const cursor = await this.syncState.getProjectCursor('github');
    const newest = newestCreatedAt(boards.map((board) => board.createdAt));

    if (cursor === null) {
      await this.syncState.setProjectCursor('github', newest ?? syncedAt);
      return [];
    }

    const captured: string[] = [];
    for (const board of boards) {
      if (!createdAfter(board.createdAt, cursor)) {
        continue;
      }
      const boardUrl = board.mirrors.github ?? '';
      if (
        boardUrl === '' ||
        links.boardUrls.has(boardUrl) ||
        links.names.has(board.name)
      ) {
        continue;
      }
      const identity = await this.projectManagement.fetchProjectIdentity({
        pm: 'github',
        repoUrl: '',
        boardUrl,
      });
      if (identity === null) {
        continue;
      }
      await this.materializeVaultProject(board.name, {
        todoistId: '',
        boardUrl,
        identity,
      });
      captured.push(board.name);
    }
    await this.syncState.setProjectCursor('github', newest ?? cursor);
    return captured;
  }

  // The vault project the capture materializes: a folder + home note (the
  // splice), plus the registry identity. The home note is never overwritten —
  // an existing project of the same name wins, and the remote project is left
  // unadopted (the lifecycle links it by name on the next pass).
  private async materializeVaultProject(
    name: string,
    options: {
      todoistId: string;
      boardUrl: string;
      identity: ProjectIdentityData;
    },
  ): Promise<void> {
    const homePath = projectHomePath(name, false);
    if ((await this.vault.getNoteByPath(homePath)) !== null) {
      return;
    }
    await this.vault.createNote(
      homePath,
      this.homeNoteContent(name, options.todoistId, options.boardUrl),
    );
    await this.syncState.setIdentity(name, options.identity);
  }

  // The home note's content: the pm provider (the code host owns the board)
  // plus the anchor(s) the birth surface supplied. A task-manager-born project
  // carries the todoist anchor and no board yet; a board-born project carries
  // the board url and no todoist anchor yet. The lifecycle fills the missing
  // anchor.
  private homeNoteContent(
    name: string,
    todoistId: string,
    boardUrl: string,
  ): string {
    const lines = ['---', 'pm: github'];
    if (todoistId !== '') {
      lines.push(`todoist: ${todoistId}`);
    }
    if (boardUrl !== '') {
      lines.push(`board: ${boardUrl}`);
    }
    lines.push('---', '', `# ${name}`, '');
    return lines.join('\n');
  }

  // The already-linked vault projects, read from the discovered home notes'
  // frontmatter. The registry has no "list every project" read, and the home
  // note's anchors are the vault-side truth for linking, so the scan is the
  // authoritative dedup source.
  private async vaultLinks(): Promise<VaultLinks> {
    const names = new Set<string>();
    const todoistIds = new Set<string>();
    const boardUrls = new Set<string>();
    for (const note of await this.vault.findProjectNotes()) {
      names.add(note.projectName);
      const content = (await this.vault.getNoteByPath(note.path))?.content;
      const fields =
        content === undefined ? undefined : splitFrontmatter(content)?.fields;
      const todoist = fields?.get('todoist');
      if (todoist !== undefined && todoist !== '') {
        todoistIds.add(todoist);
      }
      const board = fields?.get('board');
      if (board !== undefined && board !== '') {
        boardUrls.add(board);
      }
    }
    return { names, todoistIds, boardUrls };
  }
}

// The identity of a vault project whose board has not been created yet: the
// capture records the project so the lifecycle's board leg (PRJ-1) can fill in
// the addressing on the next pass.
function emptyIdentity(): ProjectIdentityData {
  return {
    repoUrl: '',
    repoNodeId: '',
    projectNodeId: '',
    statusFieldId: '',
    statusOptions: [],
  };
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

// Whether a project was created strictly after the cursor. A null clock is
// never new: the cursor must not guess, and adopting an unknown-age project
// could violate the never-adopt-preexisting guard.
function createdAfter(createdAt: string | null, cursor: string): boolean {
  return createdAt !== null && createdAt > cursor;
}
