import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { GithubTaskData } from '../DataTransferObjects/GithubTaskData.js';
import { TaskData } from '../DataTransferObjects/TaskData.js';
import { typeFromLabels } from '../Labels/typeFromLabels.js';

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
};
