import type { ProjectManagementPort } from '../github/ProjectManagementPort.js';
import type { EntityRecord, SyncStatePort } from '../registry/SyncStatePort.js';

export interface LockArchivedProjectIssuesInput {
  projectName: string;
}

// On a genuine archive transition, lock every tracked issue that is not yet
// shipped. The lane is read from the github mirror item's base (the entity
// itself carries no content); an entity with no github item is a Todoist-only
// to-do with no issue to lock. The lock runs after the folder move and Status
// relocation, so a failure retries from a consistent place.
export class LockArchivedProjectIssuesAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: LockArchivedProjectIssuesInput): Promise<void> {
    const githubByEntity = new Map<
      string,
      { handle: string; base: { status: string } | null }
    >();
    for (const { handle, item } of await this.syncState.listMirrorItems(
      input.projectName,
      'github',
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
    // Either prefix: the relocation may or may not have run for a record yet.
    const prefixes = [`Projecten/${projectName}/`, `Archief/${projectName}/`];
    return (await this.syncState.listEntities(projectName)).filter((record) =>
      prefixes.some((prefix) => record.notePath.startsWith(prefix)),
    );
  }
}
