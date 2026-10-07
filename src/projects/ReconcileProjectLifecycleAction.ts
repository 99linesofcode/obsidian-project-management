import { stampConnectionProject } from '../vault/stampConnectionProject.js';
import { connectionsOf } from '../vault/connectionsOf.js';
import type { ArchiveBaselineData } from '../shared/ArchiveBaselineData.js';
import { connectionSlugForTool } from '../shared/connectionSlugForTool.js';
import { ProjectData } from '../shared/ProjectData.js';
import type { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import type { RemoteProjectData } from '../shared/RemoteProjectData.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { TaskManagerPort } from '../shared/TaskManagerPort.js';
import type { VaultPort } from '../shared/VaultPort.js';
import { MigrateProjectHomeNoteAction } from './MigrateProjectHomeNoteAction.js';
import { LockArchivedProjectIssuesAction } from './LockArchivedProjectIssuesAction.js';

export interface ReconcileProjectLifecycleInput {
  projectName: string;
  notePath: string;
  locationArchived: boolean;
  syncedAt: string;
  // The code-host probe's board state, when the project has a board. Absent when
  // there is no code-host attach.
  closed?: boolean;
}

// The one freeze verdict the chain consumes. remoteProjectId is the resolved
// remote project when task writes are allowed and null when the project is
// frozen; frozen gates every task write (both halves) while leaving the
// project observable (it is still polled by id). archivedAt is the reconciled
// archive state: null when active, the plugin-stamped transition time once
// archived ('' when the stamp predates the plugin). notePath is the state after
// any folder backflow, so the caller works from the reconciled location.
export interface ProjectLifecycleVerdict {
  remoteProjectId: string | null;
  frozen: boolean;
  notePath: string;
  archivedAt: string | null;
}

// UC: reconcile a project's lifecycle — the vault folder position, the code-host
// board's closed state and the remote project's is_archived — into ONE freeze
// verdict. The merge is two-way (the vault wins conflicts) and the
// ArchiveBaselineData record is the last reconciled state, so a settled pair
// never re-triggers. A frozen project stays polled by id and watched through
// the ETag + newest-issue cursor; a newer issue reactivates it. A genuine
// archive transition locks every unshipped issue, and the baseline is stored
// only after a successful reconcile so a failed run retries next tick.
export class ReconcileProjectLifecycleAction {
  private readonly migrateProjectHomeNote: MigrateProjectHomeNoteAction;
  private readonly lockArchivedProjectIssues: LockArchivedProjectIssuesAction;

  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly doneOptionName: string,
  ) {
    this.migrateProjectHomeNote = new MigrateProjectHomeNoteAction(vault);
    this.lockArchivedProjectIssues = new LockArchivedProjectIssuesAction(
      syncState,
      projectManagement,
      doneOptionName,
    );
  }

  async execute(
    input: ReconcileProjectLifecycleInput,
  ): Promise<ProjectLifecycleVerdict> {
    const note = await this.vault.getNoteByPath(input.notePath);
    if (!note) {
      // The note is gone; the deletion sweep owns it.
      return {
        remoteProjectId: null,
        frozen: true,
        notePath: input.notePath,
        archivedAt: input.locationArchived ? '' : null,
      };
    }

    // The task-manager connection slug the archive/bookkeeping reconciliation
    // is keyed under. WHY the first task-manager connection: the lifecycle
    // reconciles ONE remote project's archive state; a project with two
    // task-manager connections reconciles the first here, while the per-
    // connection task halves sync both. A second connection's archive state is
    // a known limitation, not a silent one.
    const anchor = taskManagerAnchor(note.content);
    const todoistSlug = anchor?.slug ?? 'todoist';
    // The provider value comes from the connection's own tool, never a literal
    // in this neutral module.
    const taskManagerProvider = anchor?.tool ?? 'todoist';
    // The code-host connection slug the identity is keyed under.
    const githubSlug = codeHostConnectionSlug(note.content);

    // Migrate the home note to the _<project>.md convention before any write in
    // this pass, so the todoist-anchor stamping below lands on the renamed file
    // and every later step works from the new path. The vault's own
    // fileManager.renameFile updates the link graph, so existing backlinks
    // follow; the affiliation reader accepts both forms meanwhile.
    let notePath = await this.migrateProjectHomeNote.execute({
      projectName: input.projectName,
      notePath: input.notePath,
      locationArchived: input.locationArchived,
    });

    // Resolve/attach the remote project. The anchor is the identity: fetch it
    // directly (the list endpoint omits archived projects), so a frozen project
    // stays observed by id. A missing anchor — or one pointing at a project
    // that no longer exists — falls back to a name match before creating, so a
    // duplicate is never made.
    const project = await this.resolveRemoteProject(
      input.projectName,
      notePath,
      note.content,
    );

    // Name drift vs the remote project name remains a verdict (rename on
    // drift).
    if (project !== null && project.name !== input.projectName) {
      await this.taskManager.updateProject(project.id, input.projectName);
    }

    const baseline = await this.syncState.getArchiveBaseline(input.projectName);
    const todoistArchived = project?.isArchived ?? null;

    // The canonical project view the lifecycle reasons about. WHY the mapping
    // lives here: ProjectData is the canonical content shape; the registry's
    // ProjectIdentityData and ArchiveBaselineData are STORAGE shapes. Identity
    // is the attach-time addressing the adapter owns (repo/board/field ids and
    // option ids) and never enters ProjectData; the baseline is the archive
    // fact (last reconciled location/closed plus the freeze stamp), and its
    // archivedAt is the canonical stamp ProjectData carries. The core reasons
    // about ProjectData and maps it back into the two storage records at this
    // seam.
    const identity =
      githubSlug === null
        ? null
        : await this.syncState.getIdentity(input.projectName, githubSlug);
    const canonical = this.canonicalProject(
      input.projectName,
      identity,
      baseline,
      input.locationArchived,
    );

    if (!baseline) {
      // First sight adopts the current pair without transitioning, so a project
      // discovered mid-life never self-transitions. The remote project mirrors
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
      await this.syncState.setArchiveBaseline(
        input.projectName,
        this.baselineFrom(canonical, input.closed ?? input.locationArchived),
      );
      if (!input.locationArchived && project !== null) {
        await this.ensureRemoteBookkeeping(
          input.projectName,
          input.syncedAt,
          todoistSlug,
          taskManagerProvider,
          project.id,
        );
      }
      return {
        remoteProjectId: input.locationArchived ? null : (project?.id ?? null),
        frozen: input.locationArchived,
        notePath,
        archivedAt: canonical.archivedAt,
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
        const reactivated = await this.reactivateIfNewerIssue(
          input.projectName,
          input.syncedAt,
          project,
          todoistSlug,
          taskManagerProvider,
          githubSlug,
        );
        if (reactivated) {
          return await this.reactivatedVerdict(
            canonical,
            input.projectName,
            notePath,
          );
        }
      }
      return {
        remoteProjectId: archived ? null : (project?.id ?? null),
        frozen: archived,
        notePath,
        // A settled archive keeps the stamp it was given at the transition, so
        // a second pass never re-stamps it.
        archivedAt: canonical.archivedAt,
      };
    }

    // Apply the reconciled archive state to every side that disagrees.
    if (input.locationArchived !== archived) {
      notePath = await this.moveFolder(input.projectName, archived, notePath);
    }
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
      await this.lockArchivedProjectIssues.execute({
        projectName: input.projectName,
        connectionSlug: codeHostConnectionSlug(note.content),
      });
    }

    // Frozen projects stay polled by id. The watch observes reactivation; a
    // newer issue unarchives the project (folder, board and remote project),
    // and the task steps wait for the next tick's full reconcile.
    if (archived) {
      const reactivated = await this.reactivateIfNewerIssue(
        input.projectName,
        input.syncedAt,
        project,
        todoistSlug,
        taskManagerProvider,
        githubSlug,
      );
      if (reactivated) {
        return await this.reactivatedVerdict(
          canonical,
          input.projectName,
          notePath,
        );
      }
    }

    // The stamp the transition earns: syncedAt on a genuine active -> archived
    // move, the preserved baseline value when already archived.
    const archivedAt = this.stampedAt(archived, baseline, input.syncedAt);
    canonical.archivedAt = archivedAt;

    // Settle the baseline after a successful reconcile.
    await this.syncState.setArchiveBaseline(
      input.projectName,
      this.baselineFrom(canonical, archived),
    );

    return {
      remoteProjectId: archived ? null : (project?.id ?? null),
      frozen: archived,
      notePath,
      archivedAt: canonical.archivedAt,
    };
  }



  // The reconciled archive stamp: null while active; syncedAt on a genuine
  // active -> archived transition; the preserved baseline stamp when the project
  // was already archived (so a settled pass never re-stamps); '' when the
  // project was already archived before a stamp existed (migration).
  private stampedAt(
    archived: boolean,
    baseline: ArchiveBaselineData,
    syncedAt: string,
  ): string | null {
    if (!archived) {
      return null;
    }
    return baseline.locationArchived ? baseline.archivedAt : syncedAt;
  }

  // The canonical project view the lifecycle reasons about, built from the two
  // registry STORAGE shapes. WHY the split: ProjectIdentityData is the
  // attach-time addressing the adapter owns (repo/board/field ids and option
  // ids) and never enters ProjectData; ArchiveBaselineData is the archive fact
  // (last reconciled location/closed plus the freeze stamp), and its archivedAt
  // is the canonical stamp ProjectData carries. ProjectData holds only the
  // canonical content — the name, the plugin-stamped archivedAt, the status
  // option NAMES and the done lane — so the core never reasons about provider
  // ids. The reverse mapping is baselineFrom.
  private canonicalProject(
    projectName: string,
    identity: ProjectIdentityData | null,
    baseline: ArchiveBaselineData | null,
    locationArchived: boolean,
  ): ProjectData {
    return new ProjectData(
      '', // id is registry storage, not canonical content
      '', // path is registry storage; the note path is the caller's input
      identity?.repoUrl ? { github: identity.repoUrl } : {},
      projectName,
      // First sight adopts the location without a transition: an already
      // archived project carries '' because its transition time is unknown.
      baseline ? baseline.archivedAt : locationArchived ? '' : null,
      (identity?.statusOptions ?? []).map((option) => option.name),
      this.doneOptionName,
      null,
      null,
    );
  }

  // The reverse seam: the canonical project's archive fact back into the
  // registry's baseline storage shape. locationArchived is derived from the
  // canonical stamp (a project is archived exactly when it carries one), and
  // closed is the reconciled board state the caller supplies.
  private baselineFrom(
    project: ProjectData,
    closed: boolean,
  ): ArchiveBaselineData {
    return {
      locationArchived: project.archivedAt !== null,
      closed,
      archivedAt: project.archivedAt,
    };
  }

  // The remote project for a note: the anchored one, a name match, or a fresh
  // project. Stamps the anchor when it points at a project that no longer exists
  // and a name match took over. Returns null when the note has no task-manager
  // connection.
  private async resolveRemoteProject(
    projectName: string,
    notePath: string,
    noteContent: string,
  ): Promise<RemoteProjectData | null> {
    const anchor = taskManagerAnchor(noteContent);
    if (anchor === null) {
      return null;
    }
    let project = await this.taskManager.fetchProject(anchor.project);
    if (!project) {
      const projects = await this.taskManager.fetchProjects();
      project =
        projects.find((candidate) => candidate.name === projectName) ??
        (await this.taskManager.createProject(projectName));
    }

    if (anchor.project !== project.id) {
      // The connection envelope is the anchor home: a re-anchor re-keys the
      // connection's project value.
      await stampConnectionProject(
        this.vault,
        notePath,
        noteContent,
        anchor.slug,
        project.id,
      );
    }
    return project;
  }

  private async ensureRemoteBookkeeping(
    projectName: string,
    syncedAt: string,
    connectionSlug: string | null,
    provider: string,
    projectId: string,
  ): Promise<void> {
    if (connectionSlug === null) {
      return;
    }
    const state = await this.syncState.getPortState(projectName, connectionSlug);
    if (!state) {
      await this.syncState.setPortState(projectName, connectionSlug, {
        provider,
        project: projectId,
        lastPoll: syncedAt,
        lanes: {},
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
    await this.relocateStatuses(`${from}/`, `${to}/`, projectName);
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
    projectName: string,
  ): Promise<void> {
    for (const record of await this.syncState.listEntities(projectName)) {
      if (record.notePath.startsWith(fromPrefix)) {
        await this.syncState.setEntity({
          ...record,
          notePath: `${toPrefix}${record.notePath.slice(fromPrefix.length)}`,
        });
      }
    }
  }



  // The repository watch for a frozen project: a cheap conditional read asks
  // whether the newest issue changed (304 costs nothing). The first watch
  // adopts the current newest issue as the cursor, so issues predating the
  // watch don't re-activate the project. A newer issue reactivates it: folder
  // back, board reopened, remote project unarchived, watch cleared. A failed
  // reactivation throws before the watch state is cleared, so the next tick
  // retries. Returns whether the project was reactivated.
  private async reactivateIfNewerIssue(
    projectName: string,
    syncedAt: string,
    project: RemoteProjectData | null,
    connectionSlug: string | null,
    provider: string,
    githubSlug: string | null,
  ): Promise<boolean> {
    const identity =
      githubSlug === null
        ? null
        : await this.syncState.getIdentity(projectName, githubSlug);
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
      await this.reactivate(
        projectName,
        syncedAt,
        project,
        connectionSlug,
        provider,
        githubSlug,
      );
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
  // reopen the board, unarchive the remote project, relocate the Status
  // records and ensure the remote bookkeeping exists.
  private async reactivate(
    projectName: string,
    syncedAt: string,
    project: RemoteProjectData | null,
    connectionSlug: string | null,
    provider: string,
    githubSlug: string | null,
  ): Promise<void> {
    await this.moveFolder(projectName, false, '');
    const identity =
      githubSlug === null
        ? null
        : await this.syncState.getIdentity(projectName, githubSlug);
    if (identity?.projectNodeId) {
      await this.projectManagement.setProjectClosed(
        identity.projectNodeId,
        false,
      );
    }
    if (project?.isArchived) {
      await this.taskManager.setProjectArchived(project.id, false);
    }
    await this.ensureRemoteBookkeeping(
      projectName,
      syncedAt,
      connectionSlug,
      provider,
      project?.id ?? '',
    );
  }
  // The verdict a reactivated project returns: settle the baseline to active so
  // the next tick reads a settled active project. This tick still returns
  // frozen, matching the former one-tick materialisation delay.
  private async reactivatedVerdict(
    canonical: ProjectData,
    projectName: string,
    notePath: string,
  ): Promise<ProjectLifecycleVerdict> {
    canonical.archivedAt = null;
    await this.syncState.setArchiveBaseline(
      projectName,
      this.baselineFrom(canonical, false),
    );
    return {
      remoteProjectId: null,
      frozen: true,
      notePath: this.activeNotePath(projectName, notePath),
      archivedAt: canonical.archivedAt,
    };
  }
}

// The task-manager anchor for a note: the connection's slug, project value and
// tool from the connection envelope.
interface TaskManagerAnchor {
  slug: string;
  project: string;
  tool: string;
}

function taskManagerAnchor(content: string): TaskManagerAnchor | null {
  for (const [slug, connection] of Object.entries(connectionsOf(content))) {
    if (connection.tool === 'todoist' && connection.project !== '') {
      return { slug, project: connection.project, tool: connection.tool };
    }
  }
  return null;
}

// The note's code-host connection slug, or null when it has none.
function codeHostConnectionSlug(content: string): string | null {
  return connectionSlugForTool(connectionsOf(content), 'github');
}