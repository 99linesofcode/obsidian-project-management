import { TaskData } from '../shared/TaskData.js';
import type { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import { boardOptionIDByName } from '../projects/boardOptionIDByName.js';
import { toIssueBody } from '../vault/Checklist.js';
import { slugify } from '../vault/TaskNoteMapper.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';

export interface ApplyTaskToGithubInput {
  // The winning canonical task — the vault's when the vault won, the remote's
  // when the remote won. Its body is the real (rendered) body.
  task: TaskData;
  // The issue as fetched: title/body from the issue, the lane from the card,
  // and the completion stamp from the issue's own open/closed state (NOT the
  // lane-derived completion). The writer's state gate needs the raw state so a
  // stale lane cannot mask an open issue.
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
// BoardStatusAction (board lane), plus the membership-gap card add. The writer
// OWNS its base advance: after the writes resolve it stores what the issue now
// carries as the github mirror's base. The caller (SyncGithubTasksAction) owns
// nothing base-related for pushes.
export class ApplyTaskToGithubAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: ApplyTaskToGithubInput): Promise<void> {
    const { task, current } = input;
    const url = current.mirrors.github ?? task.mirrors.github ?? '';
    if (url === '') {
      return;
    }
    const identity = await this.syncState.getIdentity(input.projectName);

    // Issue content: the note body is projected for GitHub first — checklist
    // wikilinks are vault-only and never reach the issue. The title is
    // slug-compared (the vault derives it from the filename), and when only the
    // body moved the issue's own title is kept.
    const body = toIssueBody(task.body);
    const titleChanged = slugify(task.title) !== slugify(current.title);
    if (titleChanged || body !== current.body) {
      await this.projectManagement.updateTask(url, {
        title: titleChanged ? task.title : current.title,
        body,
      });
    }

    // Issue state: the completion invariant (status === doneLane <=> closed).
    // The winning task's stamp is authoritative; the raw issue state gates, so
    // the write happens only when done-ness actually differs.
    const taskDone = task.completedAt !== null;
    const currentDone = current.completedAt !== null;
    if (taskDone !== currentDone) {
      await this.projectManagement.setTaskState(
        url,
        taskDone ? 'closed' : 'open',
      );
    }

    // Board card: a missing card is a membership gap — add it and place it in
    // the winning lane; a card with no lane is backfilled from the winning
    // lane; an existing card moves only when the lane differs. A project with
    // no stored identity is board-less and skipped.
    if (identity) {
      if (!input.hasCard) {
        await this.projectManagement.addBoardItem(identity.projectNodeId, url);
        if (task.status !== '') {
          await this.setBoardStatus(identity, url, task.status);
        }
      } else if (task.status !== '' && task.status !== current.status) {
        await this.setBoardStatus(identity, url, task.status);
      }
    }

    // The parent dimension is deliberately NOT written to GitHub: sub-issue
    // move mutations are out of scope for now, so GitHub placement changes only
    // from GitHub. The asymmetry is absorbed by advanceBase below, which stores
    // the winning task's parent as the base — so a vault-side affiliation change
    // does not re-read as a fresh remote change on the next pass.
    await this.advanceBase(input.projectName, url, task, current);
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

  // Stores what the issue now carries as the mirror's base. WHY the base
  // advances only here, after every write above resolved: a base advanced
  // before the write lands makes the next pass compare the issue against a base
  // that already claims the new state, so the issue's still-stale value reads
  // as a fresh change and reverts the vault (the revert bug).
  //
  // The base is a DIFF VIEW, so its body is the digest of the comparable
  // (vault-link-free) issue body — the same form the next diff reads.
  private async advanceBase(
    projectName: string,
    url: string,
    task: TaskData,
    current: TaskData,
  ): Promise<void> {
    const item = await this.syncState.findMirrorItem('github', url);
    if (item === null) {
      return;
    }
    const record = await this.syncState.getEntity(item.entityId);
    if (record === null) {
      return;
    }
    // A title that only differs in slug form keeps the issue's own title,
    // matching what was actually written.
    const title =
      slugify(task.title) === slugify(current.title)
        ? current.title
        : task.title;
    const pushed = new TaskData({
      id: record.id,
      notePath: record.notePath,
      mirrors: {},
      title: title,
      body: toIssueBody(task.body),
      status: task.status,
      completedAt: task.completedAt,
      type: task.type,
      parent: task.parent,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
    const base = toDiffViewWithBody(pushed);
    // The no-op skip path advances the base only when it must: a base that
    // already carries this canonical diff view is left alone, so a quiet pass
    // performs no registry write (SYNC-8). A stale digest still differs here and
    // is repaired without an API write, matching ApplyTaskToTodoistAction's
    // writeBase guard so both writers behave identically.
    if (item.base !== null && item.base.canonical() === base.canonical()) {
      return;
    }
    await this.syncState.setMirrorItem(projectName, 'github', url, {
      entityId: record.id,
      base,
    });
  }
}
