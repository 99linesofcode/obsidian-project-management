import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { ApplyBoardChangeAction } from './ApplyBoardChangeAction.js';
import type { ApplyRemoteChangeAction } from './ApplyRemoteChangeAction.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';

export interface SyncProjectInput {
  projectName: string;
  syncedAt: string;
}

// UC3/UC8/UC9: sync one project. Fetches the tasks changed since the last
// poll and mirrors each onto its note — applying changes to existing notes,
// creating notes for newly promoted issues — then reconciles the board: the
// board's Status drives the issue and note (UC8), and every tracked task
// missing from the board is added to it (UC9). Finally advances the poll
// cursor. The poll needs the project's repo url, so a project without a
// stored identity (or one lacking a repo url) is skipped with a clear error
// rather than crashing.
export class SyncProjectAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly applyRemoteChange: ApplyRemoteChangeAction,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly applyBoardChange: ApplyBoardChangeAction,
  ) {}

  async execute(input: SyncProjectInput): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    if (!identity?.repoUrl) {
      throw new Error(
        `SyncProjectAction: no repo url for project ${input.projectName}`,
      );
    }

    // The first poll has no cursor yet, so since is undefined and the filter
    // is omitted to fetch everything. GitHub's since filter silently matches
    // nothing for epoch-era timestamps (verified 2026-09-19), so a sentinel
    // epoch cursor would materialise nothing.
    const since =
      (await this.syncState.getLastPoll(input.projectName)) ?? undefined;
    const tasks = await this.projectManagement.fetchChangedTasks(
      identity.repoUrl,
      since,
    );

    for (const task of tasks) {
      const status = await this.syncState.get(task.url);
      if (status) {
        await this.applyRemoteChange.execute({
          task,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      } else {
        await this.createTaskNote.execute({
          task,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      }
    }

    const items = await this.projectManagement.fetchBoardItems(
      identity.projectNodeId,
    );

    for (const item of items) {
      await this.applyBoardChange.execute({
        projectName: input.projectName,
        item,
        syncedAt: input.syncedAt,
      });
    }

    const boardUrls = new Set(
      items
        .filter((item) => item.issueUrl !== undefined)
        .map((item) => item.issueUrl as string),
    );
    const tracked = await this.syncState.list();
    for (const status of tracked) {
      if (!boardUrls.has(status.url)) {
        await this.projectManagement.addBoardItem(
          identity.projectNodeId,
          status.url,
        );
      }
    }

    await this.syncState.setLastPoll(input.projectName, input.syncedAt);
  }
}
