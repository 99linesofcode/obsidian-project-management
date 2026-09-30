import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { GithubTaskData } from '../DataTransferObjects/GithubTaskData.js';
import { TaskData } from '../DataTransferObjects/TaskData.js';

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
    return new TaskData(
      '', // identity is composed by the half from the registry record
      '', // notePath is composed by the half from the registry record
      { github: issue.url }, // the live-view mirror handle
      issue.title,
      issue.body,
      status,
      // The completion invariant: done-lane <=> completedAt !== null. GitHub
      // carries no reliable closed timestamp in the transport, so a done lane
      // stamps '' ("done, stamp unknown") rather than a fabricated date.
      done ? '' : null,
      // The `type:*` label is the mirror's REPRESENTATION of the vault-owned
      // type: the vault owns `type`, GitHub only carries its label form. The
      // mapper reads the label back so the vault can backfill a note that
      // predates the promotion.
      typeFromLabels(issue.labels),
      null, // parent is a uuid reference resolved through the registry
      issue.createdAt,
      // The content clock, not the comment-noisy updatedAt.
      issue.lastEditedAt,
    );
  },

  render(task: TaskData): GithubTaskRender {
    return {
      title: task.title,
      body: task.body,
      // The completion invariant makes the stamp and the done lane equivalent.
      state: task.completedAt !== null ? 'closed' : 'open',
      status: task.status === '' ? null : task.status,
    };
  },
};

// The vault-owned content type carried by an issue's `type:*` label, or '' when
// it carries none. The prefix is stripped and the remainder trimmed, so both
// the spaced (`type: task`) and legacy (`type:task`) conventions resolve.
export function typeFromLabels(labels: string[]): string {
  const label = labels.find((candidate) => candidate.startsWith('type:'));
  return label === undefined ? '' : label.slice('type:'.length).trim();
}
