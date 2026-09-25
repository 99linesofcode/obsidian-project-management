import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stampFrontmatterField } from '../Notes/stampFrontmatterField.js';
import type { Status } from '../Models/Status.js';
import type { TodoistProjectData } from '../DataTransferObjects/TodoistProjectData.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface ReconcileProjectLifecycleInput {
  projectName: string;
  notePath: string;
  locationArchived: boolean;
  syncedAt: string;
  // The GitHub probe's board state, when the project has a board. Absent when
  // there is no GitHub attach.
  closed?: boolean;
}

// The one freeze verdict the chain consumes. todoistProjectId is the resolved
// Todoist project when task writes are allowed and null when the project is
// frozen; frozen gates every task write (GitHub and Todoist) while leaving the
// project observable (it is still polled by id). notePath/locationArchived are
// the state after any folder backflow, so the caller works from the reconciled
// location.
export interface ProjectLifecycleVerdict {
  todoistProjectId: string | null;
  frozen: boolean;
  notePath: string;
  locationArchived: boolean;
}

// UC: reconcile a project's lifecycle in one place — the vault folder position,
// the GitHub board's closed state and the Todoist project's is_archived — with
// ONE freeze verdict. Replaces the three former encodings (the archive baseline
// merge, the GitHub-half early returns, the Todoist null return).
//
// The three-way merge is dt-15 two-way: the folder ⇄ archive state flows in
// BOTH directions. A vault folder move archives/reopens the board and the
// Todoist project; a board close/reopen moves the folder; a Todoist archive
// flows back to the folder (which then cascades to GitHub). The vault wins
// conflicts: when the folder and a remote both moved, the folder's value is
// taken. The last reconciled state is the ArchiveBaselineData record, so a
// settled pair never re-triggers.
//
// A frozen (archived) project is still polled by id: fetchProject(anchor) is
// one cheap read that keeps is_archived observable, replacing the old
// frozen-skip. The freeze now gates TASK WRITES only, not observation. An
// archived project's repository is watched through the ETag + newest-issue
// cursor; a newer issue reactivates the project (folder back, board reopened,
// Todoist unarchived) and the next tick's full reconcile materialises it.
//
// A genuine archive transition (folder active → archived) locks every tracked
// issue that is not yet shipped, after the folder move and Status relocation so
// a failure retries from a consistent place. The baseline is stored only after
// a successful reconcile, so a thrown run leaves the old baseline and the next
// tick retries.
export class ReconcileProjectLifecycleAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly doneOptionName: string,
  ) {}

  async execute(
    input: ReconcileProjectLifecycleInput,
  ): Promise<ProjectLifecycleVerdict> {
    const note = await this.vault.getNoteByPath(input.notePath);
    if (!note) {
      // The note is gone; the deletion sweep owns it.
      return {
        todoistProjectId: null,
        frozen: true,
        notePath: input.notePath,
        locationArchived: input.locationArchived,
      };
    }

    // Resolve/attach the Todoist project. The anchor is the identity: fetch it
    // directly (the list endpoint omits archived projects), so a frozen project
    // stays observed by id. A missing anchor — or one pointing at a project
    // that no longer exists — falls back to a name match before creating, so a
    // duplicate is never made.
    const project = await this.resolveTodoistProject(
      input.projectName,
      input.notePath,
      note.content,
    );

    // Name drift vs the Todoist project name remains a verdict (rename on
    // drift).
    if (project !== null && project.name !== input.projectName) {
      await this.taskManager.updateProject(project.id, input.projectName);
    }

    const baseline = await this.syncState.getArchiveBaseline(input.projectName);
    const todoistArchived = project?.isArchived ?? null;

    if (!baseline) {
      // First sight adopts the current pair without transitioning, so a project
      // discovered mid-life never self-transitions. The Todoist project mirrors
      // the folder (the vault is the source of truth).
      if (
        todoistArchived !== null &&
        todoistArchived !== input.locationArchived
      ) {
        await this.taskManager.setProjectArchived(
          project!.id,
          input.locationArchived,
        );
      }
      await this.syncState.setArchiveBaseline(input.projectName, {
        locationArchived: input.locationArchived,
        closed: input.closed ?? input.locationArchived,
      });
      if (!input.locationArchived && project !== null) {
        await this.ensureTodoistBookkeeping(input.projectName, input.syncedAt);
      }
      return {
        todoistProjectId: input.locationArchived ? null : (project?.id ?? null),
        frozen: input.locationArchived,
        notePath: input.notePath,
        locationArchived: input.locationArchived,
      };
    }

    // The three-way merge. The vault folder is checked first, so the vault wins
    // when more than one side moved (dt-01).
    const locationChanged =
      input.locationArchived !== baseline.locationArchived;
    const boardChanged =
      input.closed !== undefined && input.closed !== baseline.closed;
    const todoistChanged =
      todoistArchived !== null && todoistArchived !== baseline.locationArchived;

    let archived: boolean;
    if (locationChanged) {
      archived = input.locationArchived;
    } else if (boardChanged) {
      archived = input.closed!;
    } else if (todoistChanged) {
      archived = todoistArchived!;
    } else {
      archived = baseline.locationArchived;
    }

    // Settled: nothing moved. No side is written and the baseline is left
    // untouched (double-sync invariance). A frozen project is still watched, so
    // a newer issue can reactivate it.
    if (!locationChanged && !boardChanged && !todoistChanged) {
      if (archived) {
        const reactivated = await this.watch(
          input.projectName,
          input.syncedAt,
          project,
        );
        if (reactivated) {
          await this.syncState.setArchiveBaseline(input.projectName, {
            locationArchived: false,
            closed: false,
          });
          return {
            todoistProjectId: null,
            frozen: true,
            notePath: this.activeNotePath(input.projectName, input.notePath),
            locationArchived: false,
          };
        }
      }
      return {
        todoistProjectId: archived ? null : (project?.id ?? null),
        frozen: archived,
        notePath: input.notePath,
        locationArchived: archived,
      };
    }

    // Apply the reconciled archive state to every side that disagrees.
    let notePath = input.notePath;
    if (input.locationArchived !== archived) {
      notePath = await this.moveFolder(input.projectName, archived, notePath);
    }
    const identity = await this.syncState.getIdentity(input.projectName);
    if (
      input.closed !== undefined &&
      input.closed !== archived &&
      identity?.projectNodeId
    ) {
      await this.projectManagement.setProjectClosed(
        identity.projectNodeId,
        archived,
      );
    }
    if (todoistArchived !== null && todoistArchived !== archived) {
      await this.taskManager.setProjectArchived(project!.id, archived);
    }

    // A genuine archive transition locks every unshipped issue.
    if (archived && !baseline.locationArchived) {
      await this.lockUnshippedIssues(input.projectName);
    }

    // Frozen projects stay polled by id. The watch observes reactivation; a
    // newer issue unarchives the project (folder, board and Todoist project),
    // and the task steps wait for the next tick's full reconcile.
    if (archived) {
      const reactivated = await this.watch(
        input.projectName,
        input.syncedAt,
        project,
      );
      if (reactivated) {
        // The watch moved the folder active; settle the baseline to active so
        // the next tick reads a settled active project. This tick still returns
        // frozen, matching the former one-tick materialisation delay.
        await this.syncState.setArchiveBaseline(input.projectName, {
          locationArchived: false,
          closed: false,
        });
        return {
          todoistProjectId: null,
          frozen: true,
          notePath: this.activeNotePath(input.projectName, notePath),
          locationArchived: false,
        };
      }
    }

    // Settle the baseline after a successful reconcile.
    await this.syncState.setArchiveBaseline(input.projectName, {
      locationArchived: archived,
      closed: archived,
    });

    return {
      todoistProjectId: archived ? null : (project?.id ?? null),
      frozen: archived,
      notePath,
      locationArchived: archived,
    };
  }

  // The Todoist project for a note: the anchored one, a name match, or a fresh
  // project. Stamps the anchor when the note has none or it points at a project
  // that no longer exists and a name match took over. Returns null when the
  // provider is unavailable.
  private async resolveTodoistProject(
    projectName: string,
    notePath: string,
    noteContent: string,
  ): Promise<TodoistProjectData | null> {
    const anchor = splitFrontmatter(noteContent)?.fields.get('todoist') ?? '';
    let project =
      anchor === '' ? null : await this.taskManager.fetchProject(anchor);
    if (!project) {
      const projects = await this.taskManager.fetchProjects();
      project =
        projects.find((candidate) => candidate.name === projectName) ??
        (await this.taskManager.createProject(projectName));
    }

    if (anchor !== project.id) {
      await stampFrontmatterField(
        this.vault,
        notePath,
        noteContent,
        'todoist',
        project.id,
      );
    }
    return project;
  }

  private async ensureTodoistBookkeeping(
    projectName: string,
    syncedAt: string,
  ): Promise<void> {
    const state = await this.syncState.getTodoistProjectState(projectName);
    if (!state) {
      await this.syncState.setTodoistProjectState(projectName, {
        sections: {},
        lastCompletedPoll: syncedAt,
      });
    }
  }

  // Moves the project folder between Projecten/ and Archief/, relocates its
  // Status records and returns the note's new path.
  private async moveFolder(
    projectName: string,
    archived: boolean,
    notePath: string,
  ): Promise<string> {
    const from = archived
      ? `Projecten/${projectName}`
      : `Archief/${projectName}`;
    const to = archived ? `Archief/${projectName}` : `Projecten/${projectName}`;
    await this.vault.moveFolder(from, to);
    await this.relocateStatuses(`${from}/`, `${to}/`);
    return notePath.startsWith(`${from}/`)
      ? `${to}/${notePath.slice(from.length + 1)}`
      : notePath;
  }

  // The note's path once the project sits under Projecten/.
  private activeNotePath(projectName: string, notePath: string): string {
    const prefix = `Archief/${projectName}/`;
    return notePath.startsWith(prefix)
      ? `Projecten/${projectName}/${notePath.slice(prefix.length)}`
      : notePath;
  }

  private async relocateStatuses(
    fromPrefix: string,
    toPrefix: string,
  ): Promise<void> {
    for (const status of await this.syncState.list()) {
      if (status.notePath.startsWith(fromPrefix)) {
        await this.syncState.set({
          ...status,
          notePath: `${toPrefix}${status.notePath.slice(fromPrefix.length)}`,
        });
      }
    }
  }

  private async lockUnshippedIssues(projectName: string): Promise<void> {
    for (const status of await this.trackedIssues(projectName)) {
      if (status.lastSyncedStatus === this.doneOptionName) {
        continue;
      }
      const task = await this.projectManagement.fetchTask(status.url);
      await this.projectManagement.lockIssue(task.nodeId);
    }
  }

  private async trackedIssues(projectName: string): Promise<Status[]> {
    // Either prefix: the relocation may or may not have run for a record yet.
    const prefixes = [`Projecten/${projectName}/`, `Archief/${projectName}/`];
    return (await this.syncState.list()).filter((status) =>
      prefixes.some((prefix) => status.notePath.startsWith(prefix)),
    );
  }

  // The repository watch for a frozen project: a cheap conditional read asks
  // whether the newest issue changed (304 costs nothing). The first watch
  // adopts the current newest issue as the cursor, so issues predating the
  // watch don't re-activate the project. A newer issue reactivates it: folder
  // back, board reopened, Todoist unarchived, watch cleared. A failed
  // reactivation throws before the watch state is cleared, so the next tick
  // retries. Returns whether the project was reactivated.
  private async watch(
    projectName: string,
    syncedAt: string,
    project: TodoistProjectData | null,
  ): Promise<boolean> {
    const identity = await this.syncState.getIdentity(projectName);
    if (!identity?.repoUrl) {
      return false;
    }

    const watch = await this.syncState.getWatchState(projectName);
    const activity = await this.projectManagement.fetchLatestIssueActivity(
      identity.repoUrl,
      watch.etag ?? undefined,
    );
    if (!activity.changed) {
      return false;
    }

    if (watch.cursor === null) {
      await this.syncState.setWatchState(projectName, {
        etag: activity.etag,
        cursor: activity.newestCreatedAt,
      });
      return false;
    }

    if (
      activity.newestCreatedAt !== null &&
      activity.newestCreatedAt > watch.cursor
    ) {
      await this.reactivate(projectName, syncedAt, project);
      await this.syncState.setWatchState(projectName, {
        etag: null,
        cursor: null,
      });
      return true;
    }

    await this.syncState.setWatchState(projectName, {
      etag: activity.etag,
      cursor: watch.cursor,
    });
    return false;
  }

  // The one unarchive implementation: move the folder back to Projecten,
  // reopen the board, unarchive the Todoist project, relocate the Status
  // records and ensure the Todoist bookkeeping exists.
  private async reactivate(
    projectName: string,
    syncedAt: string,
    project: TodoistProjectData | null,
  ): Promise<void> {
    await this.moveFolder(projectName, false, '');
    const identity = await this.syncState.getIdentity(projectName);
    if (identity?.projectNodeId) {
      await this.projectManagement.setProjectClosed(
        identity.projectNodeId,
        false,
      );
    }
    if (project?.isArchived) {
      await this.taskManager.setProjectArchived(project.id, false);
    }
    await this.ensureTodoistBookkeeping(projectName, syncedAt);
  }
}
