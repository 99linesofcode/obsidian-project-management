import { TaskData } from '../shared/TaskData.js';
import { BoardStatusData } from '../shared/BoardStatusData.js';
import type { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import { boardOptionIDByName } from '../projects/boardOptionIDByName.js';
import { toIssueBody } from '../vault/Checklist.js';
import { slugify } from '../vault/TaskNoteMapper.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';

export interface ApplyTaskToGithubInput {
  task: TaskData;
  current: TaskData;
  hasCard: boolean;
  projectName: string;
  connectionSlug: string;
  syncedAt: string;
}

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
    const identity = await this.syncState.getIdentity(
      input.projectName,
      input.connectionSlug,
    );

    const body = toIssueBody(task.body);
    const titleChanged = slugify(task.title) !== slugify(current.title);
    if (titleChanged || body !== current.body) {
      await this.projectManagement.updateTask(url, {
        title: titleChanged ? task.title : current.title,
        body,
      });
    }

    const taskDone = task.completedAt !== null;
    const currentDone = current.completedAt !== null;
    if (taskDone !== currentDone) {
      await this.projectManagement.setTaskState(
        url,
        taskDone ? 'closed' : 'open',
      );
    }

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

    await this.advanceBase(
      input.projectName,
      input.connectionSlug,
      url,
      task,
      current,
    );
  }

  private async setBoardStatus(
    identity: ProjectIdentityData,
    url: string,
    statusName: string,
  ): Promise<void> {
    await this.projectManagement.setBoardStatus(
      new BoardStatusData({
        projectNodeId: identity.projectNodeId,
        statusFieldId: identity.statusFieldId,
        issueUrl: url,
        statusOptionId: boardOptionIDByName(identity.statusOptions, statusName),
      }),
    );
  }

  private async advanceBase(
    projectName: string,
    connectionSlug: string,
    url: string,
    task: TaskData,
    current: TaskData,
  ): Promise<void> {
    const item = await this.syncState.findMirrorItem(connectionSlug, url);
    if (item === null) {
      return;
    }
    const record = await this.syncState.getEntity(item.entityId);
    if (record === null) {
      return;
    }
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
    if (item.base !== null && item.base.canonical() === base.canonical()) {
      return;
    }
    await this.syncState.setMirrorItem(projectName, connectionSlug, url, {
      entityId: record.id,
      base,
    });
  }
}
