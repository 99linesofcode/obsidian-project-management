import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';

export interface LockArchivedProjectIssuesInput {
  projectName: string;
  connectionSlug: string | null;
}

export class LockArchivedProjectIssuesAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: LockArchivedProjectIssuesInput): Promise<void> {
    if (input.connectionSlug === null) {
      return;
    }
    const githubByEntity = new Map<
      string,
      { handle: string; base: { status: string } | null }
    >();
    for (const { handle, item } of await this.syncState.listMirrorItems(
      input.projectName,
      input.connectionSlug,
    )) {
      githubByEntity.set(item.entityId, { handle, base: item.base });
    }
    for (const record of await this.trackedIssues(input.projectName)) {
      const github = githubByEntity.get(record.id);
      if (
        github === undefined ||
        (github.base?.status ?? '') === this.doneOptionName
      ) {
        continue;
      }
      const task = await this.projectManagement.fetchTask(github.handle);
      await this.projectManagement.lockIssue(task.nodeId);
    }
  }

  private async trackedIssues(projectName: string): Promise<EntityRecord[]> {
    const prefixes = [`Projecten/${projectName}/`, `Archief/${projectName}/`];
    return (await this.syncState.listEntities(projectName)).filter((record) =>
      prefixes.some((prefix) => record.notePath.startsWith(prefix)),
    );
  }
}
