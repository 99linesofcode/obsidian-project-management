import type { BoardItemData } from '../shared/BoardItemData.js';
import type { GithubTaskData } from './GithubTaskData.js';
import { TaskData } from '../shared/TaskData.js';
import { typeFromLabels } from '../shared/typeFromLabels.js';

// The GitHub side of the canonical task: an issue plus its board card. The
// issue carries the content (title, body, state, labels); the card carries the
// lane (its Status option name). A card-less issue has no lane. One-way: parse
// maps the provider pair onto TaskData; the writers build their payloads
// inline, so there is no render half.
export const GithubTaskMapper = {
  // The remote live view. Identity (id, notePath) is left empty: the GitHub
  // half composes it from the registry record, never from the fetch. The done
  // lane and the lane name are supplied by the caller so the mapper stays pure.
  parse(
    issue: GithubTaskData,
    card: BoardItemData | null,
    doneLane: string,
  ): TaskData {
    const status = card?.statusOptionName ?? '';
    const done = doneLane !== '' && status === doneLane;
    return new TaskData({
      id: '',
      notePath: '',
      mirrors: { github: issue.url },
      title: issue.title,
      body: issue.body,
      status: status,
      completedAt: done ? '' : null,
      type: typeFromLabels(issue.labels),
      parent: null,
      createdAt: issue.createdAt,
      updatedAt: issue.lastEditedAt,
    });
  },
};
