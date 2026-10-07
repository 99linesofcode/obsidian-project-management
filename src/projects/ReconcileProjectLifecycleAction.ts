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
  closed?: boolean;
}

export interface ProjectLifecycleVerdict {
  remoteProjectId: string | null;
  frozen: boolean;
  notePath: string;
  archivedAt: string | null;
}

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
      return {
        remoteProjectId: null,
        frozen: true,
        notePath: input.notePath,
        archivedAt: input.locationArchived ? '' : null,
      };
    }

    const anchor = taskManagerAnchor(note.content);
    const todoistSlug = anchor?.slug ?? 'todoist';
    const taskManagerProvider = anchor?.tool ?? 'todoist';
    const githubSlug = codeHostConnectionSlug(note.content);

    let notePath = await this.migrateProjectHomeNote.execute({
      projectName: input.projectName,
      notePath: input.notePath,
      locationArchived: input.locationArchived,
    });

    const project = await this.resolveRemoteProject(
      input.projectName,
      notePath,
      note.content,
    );

    if (project !== null && project.name !== input.projectName) {
      await this.taskManager.updateProject(project.id, input.projectName);
    }

    const baseline = await this.syncState.getArchiveBaseline(input.projectName);
    const todoistArchived = project?.isArchived ?? null;

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
        archivedAt: canonical.archivedAt,
      };
    }

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

    if (archived && !baseline.locationArchived) {
      await this.lockArchivedProjectIssues.execute({
        projectName: input.projectName,
        connectionSlug: codeHostConnectionSlug(note.content),
      });
    }

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

    const archivedAt = this.stampedAt(archived, baseline, input.syncedAt);
    canonical.archivedAt = archivedAt;

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
      baseline ? baseline.archivedAt : locationArchived ? '' : null,
      (identity?.statusOptions ?? []).map((option) => option.name),
      this.doneOptionName,
      null,
      null,
    );
  }

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
    const state = await this.syncState.getPortState(
      projectName,
      connectionSlug,
    );
    if (!state) {
      await this.syncState.setPortState(projectName, connectionSlug, {
        provider,
        project: projectId,
        lastPoll: syncedAt,
        lanes: {},
      });
    }
  }

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

function codeHostConnectionSlug(content: string): string | null {
  return connectionSlugForTool(connectionsOf(content), 'github');
}
