import type { GithubTaskData } from '../DataTransferObjects/GithubTaskData.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { boardOptionIDByName } from '../Board/boardOptionIDByName.js';
import { toIssueBody } from '../Notes/Checklist.js';
import { slugify } from '../Notes/TaskNoteMapper.js';
import { hash } from '../Notes/hash.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';

export interface ApplyTaskToGithubInput {
  // The winning canonical task — the vault's when the vault won, the remote's
  // when the remote won.
  task: TaskData;
  // The remote's current canonical task (issue + card), so the writer can gate
  // each field: the gate IS the diff.
  current: TaskData;
  // Whether the issue already has a board card. A card with no lane is
  // backfilled; a missing card is added.
  hasCard: boolean;
  projectName: string;
  syncedAt: string;
}

// The GitHub writer: renders a winning canonical task onto its issue and board
// card, writing only the fields that differ. Absorbs the write paths of
// PushNoteAction (issue body/title), PropagateStatusAction (issue state) and
// BoardStatusAction (board lane), plus the sweep's membership-gap card add.
// The Status record is refreshed so the next sync sees the remote as settled.
export class ApplyTaskToGithubAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: ApplyTaskToGithubInput): Promise<void> {
    const { task, current } = input;
    const identity = await this.syncState.getIdentity(input.projectName);

    // Issue content: the note body is projected for GitHub first — checklist
    // wikilinks are vault-only and never reach the issue. The title is
    // slug-compared (the vault derives it from the filename), and when only the
    // body moved the remote's own title is kept.
    let updated: GithubTaskData | null = null;
    const body = toIssueBody(task.body);
    const titleChanged = slugify(task.title) !== slugify(current.title);
    if (titleChanged || body !== current.body) {
      updated = await this.projectManagement.updateTask(task.url, {
        title: titleChanged ? task.title : current.title,
        body,
      });
    }

    // Issue state: the winning task's completed flag is authoritative (the
    // board lane's done-ness drives it when the remote won).
    if (task.completed !== current.completed) {
      updated = await this.projectManagement.setTaskState(
        task.url,
        task.completed ? 'closed' : 'open',
      );
    }

    // Board card: a missing card is a membership gap — add it and place it in
    // the winning lane; a card with no lane is backfilled from the winning
    // lane; an existing card moves only when the lane differs. A project with
    // no stored identity is board-less and skipped.
    if (identity) {
      if (!input.hasCard) {
        await this.projectManagement.addBoardItem(
          identity.projectNodeId,
          task.url,
        );
        if (task.status !== '') {
          await this.setBoardStatus(identity, task.url, task.status);
        }
      } else if (task.status !== '' && task.status !== current.status) {
        await this.setBoardStatus(identity, task.url, task.status);
      }
    }

    await this.refreshRecord(input, updated);
  }

  private async setBoardStatus(
    identity: ProjectIdentityData,
    url: string,
    statusName: string,
  ): Promise<void> {
    await this.projectManagement.setBoardStatus(
      identity.projectNodeId,
      identity.statusFieldId,
      url,
      boardOptionIDByName(identity.statusOptions, statusName),
    );
  }

  // The record reflects the remote as of the write: the response's body and
  // updatedAt when a write happened, the current remote's otherwise. The lane
  // and title are the winning task's, since the writer just reconciled them.
  private async refreshRecord(
    input: ApplyTaskToGithubInput,
    updated: GithubTaskData | null,
  ): Promise<void> {
    const { task, current } = input;
    const existing = await this.syncState.get(task.url);
    await this.syncState.set({
      url: task.url,
      remoteId: task.remoteId,
      notePath:
        task.notePath !== '' ? task.notePath : (existing?.notePath ?? ''),
      lastSyncedBodyHash: hash(updated?.body ?? current.body),
      lastSyncedRemoteUpdatedAt: updated?.updatedAt ?? current.updatedAt,
      lastSyncedStatus: task.status,
      lastSyncedTitle: updated?.title ?? current.title,
    });
  }
}
