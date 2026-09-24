import { fillFrontmatterFields } from '../Notes/fillFrontmatterFields.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface ReconcileTodoistProjectInput {
  projectName: string;
  notePath: string;
  locationArchived: boolean;
  syncedAt: string;
}

// UC: mirror a project note's lifecycle onto its Todoist project. The vault is
// the source of truth (dt-03): every project note under Projecten/ or Archief/
// mirrors, whether or not it has a GitHub attach. The note's `todoist`
// frontmatter is the anchor (dt-04); when it is absent the project is resolved
// by name first — Todoist duplicates freely, so a name match is adopted rather
// than a second project created — and only then created and stamped. The
// project name follows the note's name, and the folder position drives
// archive/unarchive (dt-10): Archief/ archives, Projecten/ unarchives.
//
// An archived project is frozen: Todoist accepts no writes on it, so once the
// folder and the project agree on archived the action returns before any
// rename or bookkeeping. The freeze is a skip, not an error — the next tick
// re-checks, and unarchiving resumes the sync. The per-project bookkeeping
// record is created on first sight and survives the freeze.
export class ReconcileTodoistProjectAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: ReconcileTodoistProjectInput): Promise<void> {
    const note = await this.vault.getNoteByPath(input.notePath);
    if (!note) {
      return;
    }

    const anchor = splitFrontmatter(note.content)?.fields.get('todoist') ?? '';
    // The anchor is the identity: fetch it directly, because the list endpoint
    // omits archived projects. A missing anchor — or one pointing at a project
    // that no longer exists — falls back to a name match before creating, so a
    // duplicate is never made.
    let project =
      anchor === '' ? null : await this.taskManager.fetchProject(anchor);
    if (!project) {
      const projects = await this.taskManager.fetchProjects();
      project =
        projects.find((candidate) => candidate.name === input.projectName) ??
        (await this.taskManager.createProject(input.projectName));
    }

    // The anchor is the identity: stamp it when the note has none, or when it
    // points at a project that no longer exists and a name match took over.
    if (anchor !== project.id) {
      await this.stampAnchor(input.notePath, note.content, project.id);
    }

    // Frozen while archived: the folder and the project already agree, so
    // there is nothing to transition and no write is allowed. Skip with a note
    // rather than erroring, mirroring the GitHub-side freeze.
    if (input.locationArchived && project.isArchived) {
      return;
    }

    if (project.name !== input.projectName) {
      await this.taskManager.updateProject(project.id, input.projectName);
    }

    if (project.isArchived !== input.locationArchived) {
      await this.taskManager.setProjectArchived(
        project.id,
        input.locationArchived,
      );
    }

    // A project that just archived is frozen from here on; bookkeeping waits
    // for the unarchive.
    if (input.locationArchived) {
      return;
    }

    const state = await this.syncState.getTodoistProjectState(
      input.projectName,
    );
    if (!state) {
      await this.syncState.setTodoistProjectState(input.projectName, {
        sections: {},
        lastCompletedPoll: input.syncedAt,
      });
    }
  }

  // Writes the project id into the note's frontmatter, in place when the field
  // is declared and appended otherwise. A note without a frontmatter block
  // cannot carry the anchor and is left untouched.
  private async stampAnchor(
    notePath: string,
    content: string,
    projectId: string,
  ): Promise<void> {
    const lines = content.split('\n');
    if (lines[0] !== '---') {
      return;
    }
    const closing = lines.indexOf('---', 1);
    if (closing === -1) {
      return;
    }
    const frontmatter = fillFrontmatterFields(
      lines.slice(0, closing + 1),
      new Map([['todoist', projectId]]),
    );
    await this.vault.writeNote(
      notePath,
      [...frontmatter, ...lines.slice(closing + 1)].join('\n'),
    );
  }
}
