import { TaskData } from './TaskData.js';
import type { DimensionVerdict, SyncVerdict } from './SyncVerdict.js';
import { hash } from './hash.js';
import { slugify } from '../vault/TaskNoteMapper.js';
import { toIssueBody } from '../vault/Checklist.js';
import { statusNameFromState } from '../tasks/statusNameFromState.js';
import type { BoardItemData } from '../projects/BoardItemData.js';
import type { GithubTaskData } from '../github/GithubTaskData.js';

// The pure reconciliation arithmetic shared by both sync halves and the
// verdict resolver. Every function here is a total function over canonical
// tasks: no I/O, no clocks, no provider calls. Provider-shaped inputs are
// taken as narrow parameters (a state string, a card) so the arithmetic stays
// testable without a transport.

// Collapses the per-field verdicts into the one direction the writers can
// apply. A vault push takes precedence over a pull (origin authority); after
// resolveConflicts no field is left 'conflict'.
export function overallVerdict(verdicts: SyncVerdict): DimensionVerdict {
  const values: DimensionVerdict[] = [
    verdicts.title,
    verdicts.body,
    verdicts.status,
    verdicts.completedAt,
    verdicts.type,
    verdicts.parent,
  ];
  if (values.includes('push')) {
    return 'push';
  }
  if (values.includes('pull')) {
    return 'pull';
  }
  return 'none';
}

// A side is done when it carries a completion stamp or its lane is the
// project's done lane; a project with no board ('') has no done lane.
export function isDone(task: TaskData, doneLane: string): boolean {
  return (
    task.completedAt !== null || (doneLane !== '' && task.status === doneLane)
  );
}

// The reopen veto (dt-17): a pull that would move a done note OFF the done lane
// is vetoed when the mirror's own state disagrees with its lane — the issue is
// closed while its card sits in an active lane. The board lane is eventually
// consistent; a stale lane must never revert a completion.
export function reopenVetoed(
  vault: TaskData,
  remote: TaskData,
  resolved: SyncVerdict,
  issue: GithubTaskData,
  doneLane: string,
): boolean {
  if (resolved.status !== 'pull') {
    return false;
  }
  if (!isDone(vault, doneLane)) {
    return false;
  }
  return issue.state === 'closed' && remote.status !== doneLane;
}

// The lane an issue sits in: the card's lane when it carries one; otherwise the
// base lane (a card with no lane backfills from the last-synced lane) or the
// lane its state implies (a card-less issue).
export function effectiveLane(
  card: BoardItemData | null,
  issue: GithubTaskData,
  base: TaskData | null,
  doneLane: string,
  defaultLane: string,
): string {
  if (card?.statusOptionName !== undefined) {
    return card.statusOptionName;
  }
  if (card !== null) {
    return (
      base?.status ?? statusNameFromState(issue.state, doneLane, defaultLane)
    );
  }
  return statusNameFromState(issue.state, doneLane, defaultLane);
}

// The base's shape with the remote's own content: used to re-reconcile a stale
// mirror to the last-synced done state without touching the issue's title/body.
export function reconcileShape(remote: TaskData, base: TaskData): TaskData {
  return new TaskData({
    id: remote.id,
    notePath: remote.notePath,
    mirrors: remote.mirrors,
    title: remote.title,
    body: remote.body,
    status: base.status,
    completedAt: base.completedAt,
    type: base.type !== '' ? base.type : remote.type,
    parent: remote.parent,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
  });
}

// Whether a stored base already records the item as completed. A completed
// base is what tells our own close from a remote one (the echo guard).
export function hasCompletionStamp(base: TaskData | null): boolean {
  return base !== null && base.completedAt !== null;
}

// The comparable GitHub shape the diff reads: the title is slug-compared (the
// vault derives it from the filename, the remote from the issue title), the
// body is the caller's digest, and parent is preserved so GitHub sub-issue
// placement participates in the diff. Type is a constant: it travels on GitHub
// only as a `type:*` label the writer does not manage (the label is the
// mirror's representation of the vault-owned type), so it must never drive a
// pull that would overwrite the note's type.
export function githubDiffView(task: TaskData, bodyDigest: string): TaskData {
  return new TaskData({
    id: task.id,
    notePath: task.notePath,
    mirrors: task.mirrors,
    title: slugify(task.title),
    body: bodyDigest,
    status: task.status,
    completedAt: task.completedAt,
    type: '',
    parent: task.parent,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}

// The comparable Todoist shape the diff reads: the body is the digest of the
// empty comparable body (the Todoist description is not vault content), and the
// type is excluded — the vault-owned type never rides a Todoist base.
export function todoistDiffView(task: TaskData): TaskData {
  return new TaskData({
    id: task.id,
    notePath: task.notePath,
    mirrors: {},
    title: task.title,
    body: hash(''),
    status: task.status,
    completedAt: task.completedAt,
    type: '',
    parent: task.parent,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}

// Whether the note's live view still matches its mirror's base. The title is
// slug-compared (the vault derives it from the filename). Parent and type are
// excluded: the parsed vault view leaves parent unresolved (the action layer
// resolves the affiliation, and GitHub placement changes only from GitHub), and
// type is vault-owned — neither can be a GitHub write this gate must re-open
// for.
export function matchesBase(vault: TaskData, base: TaskData): boolean {
  return (
    hash(toIssueBody(vault.body)) === base.body &&
    vault.status === base.status &&
    slugify(vault.title) === slugify(base.title) &&
    vault.completedAt === base.completedAt
  );
}
