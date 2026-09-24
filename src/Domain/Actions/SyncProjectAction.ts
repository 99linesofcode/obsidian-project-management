import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import { hasTypeLabel } from '../Labels/hasTypeLabel.js';
import { boardOptionIDByName } from '../Board/boardOptionIDByName.js';
import { defaultStatusName } from '../Board/defaultStatusName.js';
import { statusNameFromState } from '../Board/statusNameFromState.js';
import type { ApplyBoardChangeAction } from './ApplyBoardChangeAction.js';
import type { ApplyRemoteChangeAction } from './ApplyRemoteChangeAction.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';

export interface SyncProjectInput {
  projectName: string;
  syncedAt: string;
  includeBoard: boolean;
}

// UC3/UC8/UC9: sync one project. Fetches the complete tracked issue set and
// mirrors each onto its note — applying changes to existing notes, creating
// notes for newly promoted issues — then reconciles the board: the board's
// Status drives the issue and note (UC8), and every tracked task missing from
// the board is added to it (UC9). The sync state is the diff: an issue whose
// last update predates the previous poll still materializes. The poll needs
// the project's repo url, so a project without a stored identity (or one
// lacking a repo url) is skipped with a clear error rather than crashing.
// includeBoard gates the board half on the remote updatedAt, but a membership
// gap opens it too: a newly tracked issue has no card and does not move the
// board, so the probe gate alone would starve its bookkeeping. A manually
// removed card does move the board, caught by the gate. When the board is
// fetched, an added card starts in the lane its issue state implies.
export class SyncProjectAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly applyRemoteChange: ApplyRemoteChangeAction,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly applyBoardChange: ApplyBoardChangeAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: SyncProjectInput): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    if (!identity?.repoUrl) {
      throw new Error(
        `SyncProjectAction: no repo url for project ${input.projectName}`,
      );
    }

    // Every poll reconciles the complete tracked set; the sync state is the
    // diff, so an issue that went quiet before its type label was added still
    // materializes. Only tasks carrying a type label are tracked.
    const tasks = (
      await this.projectManagement.fetchTrackedIssues(identity.repoUrl)
    ).filter((task) => hasTypeLabel(task.labels));

    // A fetched task the vault has never recorded is a membership gap. Capture
    // it before materializing: creating a note writes the record, which would
    // erase the gap we need to detect.
    const knownUrls = new Set(
      (await this.syncState.list()).map((status) => status.url),
    );
    const hasUntracked = tasks.some((task) => !knownUrls.has(task.url));

    // The lane a task's issue state implies when the board is not the
    // source: closed issues sit in the done lane, open ones in the default.
    const fallbackStatusName = statusNameFromState(
      'open',
      this.doneOptionName,
      defaultStatusName(identity.statusOptions),
    );
    const doneStatusName = statusNameFromState(
      'closed',
      this.doneOptionName,
      defaultStatusName(identity.statusOptions),
    );

    for (const task of tasks) {
      const statusName =
        task.state === 'closed' ? doneStatusName : fallbackStatusName;
      const status = await this.syncState.get(task.url);
      if (status) {
        await this.applyRemoteChange.execute({
          task,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
          statusName,
        });
      } else {
        await this.createTaskNote.execute({
          task,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
          statusName,
        });
      }
    }

    // The board fetch is the expensive half of the poll, so the scheduler gates
    // it on the project's remote updatedAt. A board change always moves that
    // updatedAt, so a skipped board fetch resumes on the next tick after any
    // board activity — including card removals, which the bookkeeping re-adds.
    // A membership gap opens the gate too, so a new issue's bookkeeping does
    // not wait for unrelated board activity.
    if (!input.includeBoard && !hasUntracked) {
      return;
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
    const taskByUrl = new Map(tasks.map((task) => [task.url, task] as const));
    const tracked = await this.syncState.list();
    for (const status of tracked) {
      if (boardUrls.has(status.url)) {
        continue;
      }
      await this.projectManagement.addBoardItem(
        identity.projectNodeId,
        status.url,
      );

      const task = taskByUrl.get(status.url);
      if (!task) {
        // A record whose issue is no longer fetched has no state to derive a
        // lane from; leave the card where GitHub placed it.
        continue;
      }
      const statusName = statusNameFromState(
        task.state,
        this.doneOptionName,
        defaultStatusName(identity.statusOptions),
      );
      await this.projectManagement.setBoardStatus(
        identity.projectNodeId,
        identity.statusFieldId,
        status.url,
        boardOptionIDByName(identity.statusOptions, statusName),
      );
    }
  }
}
