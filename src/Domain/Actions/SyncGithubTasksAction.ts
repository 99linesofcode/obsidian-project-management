import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { GithubTaskData } from '../DataTransferObjects/GithubTaskData.js';
import { TaskData } from '../DataTransferObjects/TaskData.js';
import { defaultStatusName } from '../Board/defaultStatusName.js';
import { statusNameFromState } from '../Board/statusNameFromState.js';
import { hasTypeLabel } from '../Labels/hasTypeLabel.js';
import {
  GithubTaskMapper,
  typeFromLabels,
} from '../Mappers/GithubTaskMapper.js';
import { VaultTaskMapper } from '../Mappers/VaultTaskMapper.js';
import { toIssueBody } from '../Notes/Checklist.js';
import { hash } from '../Notes/hash.js';
import { parseAffiliation } from '../Notes/parseAffiliation.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stampFrontmatterField } from '../Notes/stampFrontmatterField.js';
import { slugify } from '../Notes/TaskNoteMapper.js';
import { taskLinkFromAffiliation } from '../Notes/taskLinkFromAffiliation.js';
import type { ConflictHints } from '../Reconciliation/VerdictResolver.js';
import { VerdictResolver } from '../Reconciliation/VerdictResolver.js';
import type {
  DimensionVerdict,
  SyncVerdict,
} from '../Reconciliation/SyncVerdict.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { EntityRecord, SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { ApplyTaskToGithubAction } from './ApplyTaskToGithubAction.js';
import type { ApplyTaskToVaultAction } from './ApplyTaskToVaultAction.js';

export interface SyncGithubTasksInput {
  projectName: string;
  syncedAt: string;
  // The probe's verdict: the project's remote updatedAt moved since the last
  // poll. When false, the fetch is skipped unless the vault drifted.
  includeBoard: boolean;
}

// The GitHub half on the uuid-keyed registry: probe gate → single-query project
// detail fetch → per issue, resolve its record by mirror handle → map the
// remote live view, read the note's live view, read the mirror's base → per-
// field three-way diff → apply the winning side through the two writers.
//
// Identity always comes from the registry, never from the fetch: the mapper
// leaves id/notePath empty and this action composes them from the record. All
// diffing operates on diff views (body = digest); base storage is a diff view.
//
// The reopen veto (dt-17, the revert fix) lives here: a pull that would move a
// done note off the done lane is vetoed while the mirror's own state disagrees
// with its lane (a closed issue whose card sits in an active lane). The board
// lane is eventually consistent, so a stale lane must never revert a
// completion; the mirror is re-reconciled to the base instead.
export class SyncGithubTasksAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly vault: VaultPort,
    private readonly applyToGithub: ApplyTaskToGithubAction,
    private readonly applyToVault: ApplyTaskToVaultAction,
    private readonly verdictResolver: VerdictResolver,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: SyncGithubTasksInput): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    if (!identity?.repoUrl) {
      throw new Error(
        `SyncGithubTasksAction: no repo url for project ${input.projectName}`,
      );
    }

    // The probe gate: skip the whole fetch when the remote is unmoved and the
    // vault is settled. A vault-side drift re-opens it so the drift can be
    // pushed; a project with no github-mirrored records is unknown, so it
    // fetches.
    if (!input.includeBoard && !(await this.hasVaultDrift(input.projectName))) {
      return;
    }

    const detail = await this.projectManagement.fetchProjectDetail(
      identity.repoUrl,
      identity.projectNodeId,
    );
    const issues = detail.issues.filter((issue) => hasTypeLabel(issue.labels));
    const cardByUrl = new Map(
      detail.cards
        .filter((card) => card.issueUrl !== undefined)
        .map((card) => [card.issueUrl as string, card] as const),
    );

    const doneLane = this.doneOptionName;
    const defaultLane = defaultStatusName(identity.statusOptions);

    for (const issue of issues) {
      const card = cardByUrl.get(issue.url) ?? null;
      // Handle-index resolution: the issue url is the github mirror handle.
      const item = await this.syncState.findMirrorItem('github', issue.url);
      const record =
        item === null ? null : await this.syncState.getEntity(item.entityId);
      if (record === null) {
        await this.materializeUntracked(
          issue,
          card,
          input,
          doneLane,
          defaultLane,
        );
        continue;
      }
      await this.reconcileTracked(
        issue,
        card,
        record,
        item?.base ?? null,
        input,
        doneLane,
        defaultLane,
      );
    }
  }

  // An untracked issue: materialise the note and add the card. A closed
  // untracked issue is skipped — it is either swept or pre-plugin history, and
  // the vault is the source of truth; reopening it on GitHub makes it an open
  // untracked issue, so it materialises then. The raw state gates the decision,
  // not the lane-derived completion (a closed issue with a stale card in an
  // active lane still reads closed here).
  private async materializeUntracked(
    issue: GithubTaskData,
    card: BoardItemData | null,
    input: SyncGithubTasksInput,
    doneLane: string,
    defaultLane: string,
  ): Promise<void> {
    if (issue.state === 'closed') {
      return;
    }
    const { remote, raw } = this.remoteViews(
      issue,
      null,
      null,
      card,
      doneLane,
      defaultLane,
    );
    // The vault writer creates the note (fresh uuid) and the registry record,
    // and advances the base after the durable write (origin pull).
    await this.applyToVault.execute({
      task: remote,
      current: null,
      projectName: input.projectName,
      syncedAt: input.syncedAt,
      origin: 'pull',
    });
    // The card add is a GitHub write; the writer owns the base advance.
    await this.applyToGithub.execute({
      task: remote,
      current: raw,
      hasCard: card !== null,
      projectName: input.projectName,
      syncedAt: input.syncedAt,
    });
  }

  private async reconcileTracked(
    issue: GithubTaskData,
    card: BoardItemData | null,
    record: EntityRecord,
    base: TaskData | null,
    input: SyncGithubTasksInput,
    doneLane: string,
    defaultLane: string,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(record.notePath);
    // The note is gone; the deletion sweep owns it.
    if (note === null) {
      return;
    }
    const vault = VaultTaskMapper.parseTask(note.content, record.notePath, {
      projectName: input.projectName,
      doneLane,
    });
    if (vault === null) {
      return;
    }
    // The parser no longer carries the id (dt-20); the registry record is the
    // identity source, so compose it here.
    vault.id = record.id;

    const { remote, raw } = this.remoteViews(
      issue,
      record,
      base,
      card,
      doneLane,
      defaultLane,
    );

    // The pure mapper leaves parent null: the affiliation link names the parent
    // note, and only the registry can turn that path into the parent's uuid.
    vault.parent = await this.resolveParent(note.content, input.projectName);

    // Type backfill: a note or record that predates the type promotion adopts
    // the issue's type label. Stamping both settles the type field.
    const effectiveBase = await this.backfillType(
      issue,
      record,
      base,
      vault,
      note.content,
      input.projectName,
    );

    const vaultDiff = this.diffView(vault, hash(toIssueBody(vault.body)));
    const remoteDiff = this.diffView(remote, hash(remote.body));
    const baseDiff =
      effectiveBase === null
        ? remoteDiff
        : this.diffView(effectiveBase, effectiveBase.body);

    const verdicts = this.verdictResolver.diff(vaultDiff, remoteDiff, baseDiff);
    const resolved = this.verdictResolver.resolveConflicts(
      vaultDiff,
      remoteDiff,
      verdicts,
      await this.conflictHints(issue, card, record.notePath),
    );
    const overall = overallVerdict(resolved);

    if (overall === 'push') {
      // Origin authority: the vault wins. The writer renders it onto the issue.
      await this.applyToGithub.execute({
        task: vault,
        current: raw,
        hasCard: card !== null,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
      });
      return;
    }

    if (overall === 'pull') {
      const vetoed = reopenVetoed(vault, remote, resolved, issue, doneLane);
      if (!vetoed) {
        await this.applyToVault.execute({
          task: remote,
          current: vault,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
          origin: 'pull',
          record,
        });
      }
      // The completion invariant: a done lane implies a closed issue. When the
      // lane and the issue's own state disagree, reconcile the issue. On a
      // veto the base's shape is re-asserted so the stale card lane catches up
      // to the closed issue; otherwise the lane-derived remote shape is applied.
      const laneDone = remote.completedAt !== null;
      const stateDone = raw.completedAt !== null;
      if (vetoed && base !== null) {
        await this.applyToGithub.execute({
          task: reconcileShape(remote, base),
          current: raw,
          hasCard: card !== null,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      } else if (laneDone !== stateDone) {
        await this.applyToGithub.execute({
          task: remote,
          current: raw,
          hasCard: card !== null,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      }
      return;
    }

    // Nothing content-wise moved: a membership gap (no card) or a lane gap (a
    // card with no lane) is the only reason to write.
    if (card === null || card.statusOptionName === undefined) {
      await this.applyToGithub.execute({
        task: remote,
        current: raw,
        hasCard: card !== null,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
      });
    }
  }

  // The two remote views for one issue. `remote` is the canonical live view:
  // the lane is authoritative for done-ness and falls back to the base lane (a
  // card with no lane) or the lane its state implies (a card-less issue).
  // `raw` is the issue as fetched: its completion stamp is the issue's own
  // open/closed state, so the writer can tell a stale lane from a real reopen.
  private remoteViews(
    issue: GithubTaskData,
    record: EntityRecord | null,
    base: TaskData | null,
    card: BoardItemData | null,
    doneLane: string,
    defaultLane: string,
  ): { remote: TaskData; raw: TaskData } {
    const parsed = GithubTaskMapper.parse(issue, card, doneLane);
    const lane = effectiveLane(card, issue, base, doneLane, defaultLane);
    const laneDone = doneLane !== '' && lane === doneLane;
    const stateDone = issue.state === 'closed';
    const cardLane = card?.statusOptionName ?? '';
    const id = record?.id ?? '';
    const notePath = record?.notePath ?? '';
    const mirrors = { github: parsed.mirrors.github ?? '' };

    const remote = new TaskData(
      id,
      notePath,
      mirrors,
      parsed.title,
      parsed.body,
      lane,
      laneDone ? '' : null,
      parsed.type,
      parsed.parent,
      parsed.createdAt,
      parsed.updatedAt,
    );
    const raw = new TaskData(
      id,
      notePath,
      mirrors,
      parsed.title,
      parsed.body,
      cardLane,
      stateDone ? '' : null,
      parsed.type,
      parsed.parent,
      parsed.createdAt,
      parsed.updatedAt,
    );
    return { remote, raw };
  }

  // The timing evidence the conflict ladder may use: the note's real mtime and
  // the issue's honest clocks. GitHub's lastEditedAt is the title/body clock
  // (comments never move it); the card's own updatedAt is the lane clock.
  private async conflictHints(
    issue: GithubTaskData,
    card: BoardItemData | null,
    notePath: string,
  ): Promise<ConflictHints> {
    return {
      vaultModifiedAt: await this.vault.modifiedTime(notePath),
      remoteFieldTimes: {
        title: issue.lastEditedAt,
        body: issue.lastEditedAt,
        status: card?.updatedAt ?? null,
      },
    };
  }

  // The comparable shape the diff reads: the title is slug-compared (the vault
  // derives it from the filename, the remote from the issue title), the body is
  // the caller's digest, and parent/type are constants — neither is a
  // GitHub-synced field. Parent is a uuid reference resolved through the
  // registry; type travels on GitHub only as a `type:*` label the writer does
  // not manage (the label is the mirror's representation of the vault-owned
  // type), so it must never drive a pull that would overwrite the note's type.
  private diffView(task: TaskData, bodyDigest: string): TaskData {
    return new TaskData(
      task.id,
      task.notePath,
      task.mirrors,
      slugify(task.title),
      bodyDigest,
      task.status,
      task.completedAt,
      '',
      null,
      task.createdAt,
      task.updatedAt,
    );
  }

  // Resolves a note's affiliation link to its parent's uuid through the
  // registry. A link may be a full note path or a bare stem, so the taken and
  // todos folders are tried; an unresolved parent stays null and the next pass
  // retries once the parent note is known.
  private async resolveParent(
    content: string,
    projectName: string,
  ): Promise<string | null> {
    const fields = splitFrontmatter(content)?.fields;
    if (fields === undefined) {
      return null;
    }
    const link = taskLinkFromAffiliation(
      parseAffiliation(fields.get('affiliation')),
      projectName,
    );
    if (link === null || link === '') {
      return null;
    }
    // A uuid reference resolves directly; a link target resolves by path.
    if ((await this.syncState.getEntity(link)) !== null) {
      return link;
    }
    for (const candidate of [
      link,
      `Projecten/${projectName}/taken/${link}.md`,
      `Projecten/${projectName}/todos/${link}.md`,
    ]) {
      const record = await this.syncState.findByNotePath(candidate);
      if (record !== null) {
        return record.id;
      }
    }
    return null;
  }

  // Stamps the vault-owned type from the issue's type label when the note or
  // the record's base lacks one (the migration path for existing notes). The
  // note frontmatter and the base both move, so the type field settles. Returns
  // the (possibly updated) base.
  private async backfillType(
    issue: GithubTaskData,
    record: EntityRecord,
    base: TaskData | null,
    vault: TaskData,
    content: string,
    projectName: string,
  ): Promise<TaskData | null> {
    const issueType = typeFromLabels(issue.labels);
    if (issueType === '') {
      return base;
    }
    if (vault.type === '') {
      await stampFrontmatterField(
        this.vault,
        record.notePath,
        content,
        'type',
        issueType,
      );
      vault.type = issueType;
    }
    if (base !== null && base.type === '') {
      base.type = vault.type !== '' ? vault.type : issueType;
      await this.syncState.setMirrorItem(projectName, 'github', issue.url, {
        entityId: record.id,
        base,
      });
    }
    return base;
  }

  // A vault-side drift: a github-mirrored entity whose note no longer matches
  // its base. A project with no such entities is unknown and counts as drift,
  // so a newly tracked issue is never starved by the probe gate.
  private async hasVaultDrift(projectName: string): Promise<boolean> {
    const prefix = `Projecten/${projectName}/`;
    const entries = await this.syncState.listMirrorItems(projectName, 'github');
    const records: Array<{ record: EntityRecord; base: TaskData | null }> = [];
    for (const entry of entries) {
      const record = await this.syncState.getEntity(entry.item.entityId);
      if (record !== null && record.notePath.startsWith(prefix)) {
        records.push({ record, base: entry.item.base });
      }
    }
    if (records.length === 0) {
      return true;
    }

    for (const { record, base } of records) {
      if (base === null) {
        return true;
      }
      const note = await this.vault.getNoteByPath(record.notePath);
      if (note === null) {
        continue;
      }
      const parsed = VaultTaskMapper.parseTask(note.content, record.notePath, {
        projectName,
        doneLane: this.doneOptionName,
      });
      if (parsed === null) {
        return true;
      }
      if (!matchesBase(parsed, base)) {
        return true;
      }
    }
    return false;
  }
}

// The lane an issue sits in: the card's lane when it carries one; otherwise the
// base lane (a card with no lane backfills from the last-synced lane) or the
// lane its state implies (a card-less issue).
function effectiveLane(
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
function reconcileShape(remote: TaskData, base: TaskData): TaskData {
  return new TaskData(
    remote.id,
    remote.notePath,
    remote.mirrors,
    remote.title,
    remote.body,
    base.status,
    base.completedAt,
    base.type !== '' ? base.type : remote.type,
    remote.parent,
    remote.createdAt,
    remote.updatedAt,
  );
}

// The reopen veto (dt-17): a pull that would move a done note OFF the done lane
// is vetoed when the mirror's own state disagrees with its lane — the issue is
// closed while its card sits in an active lane. The board lane is eventually
// consistent; a stale lane must never revert a completion.
function reopenVetoed(
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

// Collapses the per-field verdicts into the one direction the writers can
// apply. A vault push takes precedence over a pull (origin authority); after
// resolveConflicts no field is left 'conflict'.
function overallVerdict(verdicts: SyncVerdict): DimensionVerdict {
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
function isDone(task: TaskData, doneLane: string): boolean {
  return (
    task.completedAt !== null || (doneLane !== '' && task.status === doneLane)
  );
}

// Whether the note's live view still matches its mirror's base. The title is
// slug-compared (the vault derives it from the filename); parent and type are
// excluded (neither is a GitHub-synced field).
function matchesBase(vault: TaskData, base: TaskData): boolean {
  return (
    hash(toIssueBody(vault.body)) === base.body &&
    vault.status === base.status &&
    slugify(vault.title) === slugify(base.title) &&
    vault.completedAt === base.completedAt
  );
}
