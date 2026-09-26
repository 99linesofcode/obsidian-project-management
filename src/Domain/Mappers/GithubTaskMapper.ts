import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { GithubTaskData } from '../DataTransferObjects/GithubTaskData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';

// The GitHub side of the canonical task: an issue plus its board card. The
// issue carries the content (title, body, state, labels); the card carries the
// lane (its Status option name). A card-less issue has no lane. Two-way: parse
// maps the provider pair onto TaskData, render maps TaskData back onto the
// issue fields and the lane.
export interface GithubTaskRender {
  title: string;
  body: string;
  state: 'open' | 'closed';
  status: string | null;
}

export const GithubTaskMapper = {
  parse(issue: GithubTaskData, card: BoardItemData | null): TaskData {
    return {
      url: issue.url,
      remoteId: issue.remoteId,
      nodeId: issue.nodeId,
      todoistId: '',
      notePath: '',
      title: issue.title,
      body: issue.body,
      status: card?.statusOptionName ?? '',
      completed: issue.state === 'closed',
      parent: null,
      labels: [...issue.labels],
      updatedAt: issue.updatedAt,
    };
  },

  render(task: TaskData): GithubTaskRender {
    return {
      title: task.title,
      body: task.body,
      state: task.completed ? 'closed' : 'open',
      status: task.status === '' ? null : task.status,
    };
  },
};
