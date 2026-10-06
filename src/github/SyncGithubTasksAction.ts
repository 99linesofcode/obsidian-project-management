import type { BoardItemData } from './BoardItemData.js';
import type { GithubTaskData } from './GithubTaskData.js';
import type { ProjectIdentityData } from '../projects/ProjectIdentityData.js';
import { TaskData } from '../shared/TaskData.js';
import { boardOptionIDByName } from '../projects/boardOptionIDByName.js';
import { defaultStatusName } from '../projects/defaultStatusName.js';
import { hasTypeLabel } from '../shared/hasTypeLabel.js';
import { typeFromLabels } from '../shared/typeFromLabels.js';
import { GithubTaskMapper } from './GithubTaskMapper.js';
import { VaultTaskMapper } from '../vault/VaultTaskMapper.js';
import { toIssueBody } from '../vault/Checklist.js';
import { hash } from '../shared/hash.js';
import { parseAffiliation } from '../shared/parseAffiliation.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import { stampFrontmatterField } from '../vault/stampFrontmatterField.js';
import { taskLinkFromAffiliation } from '../shared/taskLinkFromAffiliation.js';
import { toDiffView } from '../shared/toDiffView.js';
import type { ConflictHints } from '../shared/VerdictResolver.js';
import { VerdictResolver } from '../shared/VerdictResolver.js';
import {
  effectiveLane,
  githubDiffView,
  matchesBase,
  overallVerdict,
  reconcileShape,
  reopenVetoed,
} from '../shared/Reconciliation.js';
import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';
import type { ApplyTaskToGithubAction } from './ApplyTaskToGithubAction.js';
import type { ApplyTaskToVaultAction } from '../tasks/ApplyTaskToVaultAction.js';
import type { CodeHostSyncHalf } from '../sync/SyncHalves.js';

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
export class SyncGithubTasksAction implements CodeHostSyncHalf {
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
    if (identity === null) {
      throw new Error(
        `SyncGithubTasksAction: no repo url for project ${input.projectName}`,
      );
    }
    // A board without a repository attached (ATT-1 is a separate act): there
    // are no issues to fetch, so the half is a quiet no-op rather than a
    // per-tick failure. The board is still probed and archived by the chain.
    if (identity.repoUrl === '') {
      return;
    }

    // The probe gate: skip the whole fetch when the remote is unmoved and the
    // vault is settled. A vault-side drift re-opens it so the drift can be
    // pushed; a project with no github-mirrored records is unknown, so it
    // fetches. Outward drift (a vault-born task note with no github mirror)
    // also re-opens it, so a new note materializes even when the board is
    // quiet.
    if (
      !input.includeBoard &&
      !(await this.hasVaultDrift(input.projectName)) &&
      !(await this.hasOutwardDrift(input.projectName))
    ) {
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

    // Outward materialization runs AFTER the per-issue loop so existing mirrors
    // settle first. A vault-born task note with no github mirror gains an issue
    // and a card; a creation failure leaves the entity unmirrored and the next
    // pass retries.
    await this.materializeOutward(input, identity, doneLane, defaultLane);
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
    const { remote, issueAsFetched } = await this.remoteViews(
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
      current: issueAsFetched,
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

    const { remote, issueAsFetched } = await this.remoteViews(
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

    const vaultDiff = githubDiffView(vault, hash(toIssueBody(vault.body)));
    const remoteDiff = githubDiffView(remote, hash(remote.body));
    const baseDiff =
      effectiveBase === null
        ? remoteDiff
        : githubDiffView(effectiveBase, effectiveBase.body);

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
        current: issueAsFetched,
        hasCard: card !== null,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
      });
      return;
    }

    if (overall === 'pull') {
      const vetoed = reopenVetoed(
        vault,
        remote,
        resolved,
        issue.state === 'closed',
        doneLane,
      );
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
      const stateDone = issueAsFetched.completedAt !== null;
      if (vetoed && base !== null) {
        await this.applyToGithub.execute({
          task: reconcileShape(remote, base),
          current: issueAsFetched,
          hasCard: card !== null,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      } else if (laneDone !== stateDone) {
        await this.applyToGithub.execute({
          task: remote,
          current: issueAsFetched,
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
        current: issueAsFetched,
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
  //
  // The parent is the resolved sub-issue relation: a parentUrl that the registry
  // knows becomes the parent entity's uuid, so GitHub-side placement is visible
  // to the parent diff. A top-level issue (or an untracked parent) stays null.
  private async remoteViews(
    issue: GithubTaskData,
    record: EntityRecord | null,
    base: TaskData | null,
    card: BoardItemData | null,
    doneLane: string,
    defaultLane: string,
  ): Promise<{ remote: TaskData; issueAsFetched: TaskData }> {
    const parsed = GithubTaskMapper.parse(issue, card, doneLane);
    const lane = effectiveLane(
      card?.statusOptionName,
      card !== null,
      issue.state,
      base?.status,
      doneLane,
      defaultLane,
    );
    const laneDone = doneLane !== '' && lane === doneLane;
    const stateDone = issue.state === 'closed';
    const cardLane = card?.statusOptionName ?? '';
    const id = record?.id ?? '';
    const notePath = record?.notePath ?? '';
    const mirrors = { github: parsed.mirrors.github ?? '' };
    const parent = await this.parentUuidFromIssue(issue);

    const remote = new TaskData({
      id: id,
      notePath: notePath,
      mirrors: mirrors,
      title: parsed.title,
      body: parsed.body,
      status: lane,
      completedAt: laneDone ? '' : null,
      type: parsed.type,
      parent: parent,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    });
    const issueAsFetched = new TaskData({
      id: id,
      notePath: notePath,
      mirrors: mirrors,
      title: parsed.title,
      body: parsed.body,
      status: cardLane,
      completedAt: stateDone ? '' : null,
      type: parsed.type,
      parent: parent,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    });
    return { remote, issueAsFetched };
  }

  // The uuid of the issue's parent relation, resolved through the registry: the
  // parentUrl is the parent's github mirror handle. WHY the registry and not the
  // transport: identity is hub-side, so the pure mapper leaves parent null and
  // the half composes it here. An untracked parent resolves to null, which keeps
  // the child top-level until the parent materializes.
  private async parentUuidFromIssue(
    issue: GithubTaskData,
  ): Promise<string | null> {
    if (issue.parentUrl === null || issue.parentUrl === '') {
      return null;
    }
    const item = await this.syncState.findMirrorItem('github', issue.parentUrl);
    if (item === null) {
      return null;
    }
    return (await this.syncState.getEntity(item.entityId))?.id ?? null;
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

  // Outward drift: a typed task note in the project's taken/ folder with no
  // github mirror. WHY the GitHub half owns this: a vault-born note has no
  // registry record until a half creates one, and the GitHub half is the one
  // that materializes it outward, so it creates the entity itself rather than
  // waiting for the Todoist half (which may be frozen or absent). A note with
  // no record counts as drift, so the gate opens for it.
  private async hasOutwardDrift(projectName: string): Promise<boolean> {
    const folder = `Projecten/${projectName}/taken`;
    for (const notePath of await this.vault.listNotesInFolder(folder)) {
      const record = await this.syncState.findByNotePath(notePath);
      if (
        record !== null &&
        (await this.hasGithubMirror(record.id))
      ) {
        continue;
      }
      const note = await this.vault.getNoteByPath(notePath);
      if (note === null) {
        continue;
      }
      const parsed = VaultTaskMapper.parseTask(note.content, notePath, {
        projectName,
        doneLane: this.doneOptionName,
      });
      // Only a typed task note is materializable; an untyped or malformed note
      // must not hold the gate open forever.
      if (parsed !== null && parsed.type !== '') {
        return true;
      }
    }
    return false;
  }

  // The outward phase: every taken/ task note with no github mirror gains an
  // issue, a board card in the note's lane, and a mirror item. To-dos live in
  // todos/ and are never issues; a note with no vault-owned type cannot carry
  // the type label the adoption gate requires, so it is skipped.
  private async materializeOutward(
    input: SyncGithubTasksInput,
    identity: ProjectIdentityData,
    doneLane: string,
    defaultLane: string,
  ): Promise<void> {
    const folder = `Projecten/${input.projectName}/taken`;
    for (const notePath of await this.vault.listNotesInFolder(folder)) {
      const note = await this.vault.getNoteByPath(notePath);
      if (note === null) {
        continue;
      }
      const vault = VaultTaskMapper.parseTask(note.content, notePath, {
        projectName: input.projectName,
        doneLane,
      });
      if (vault === null || vault.type === '') {
        continue;
      }
      const existing = await this.syncState.findByNotePath(notePath);
      if (
        existing !== null &&
        (await this.hasGithubMirror(existing.id))
      ) {
        // Already mirrored: the per-issue loop owns it; leave it untouched.
        continue;
      }
      try {
        await this.createOutward(
          existing,
          vault,
          notePath,
          input,
          identity,
          defaultLane,
        );
      } catch (error) {
        // A failed creation leaves the entity unmirrored (no partial mirror
        // state); the next pass sees the same outward drift and retries. One
        // note's failure must not starve the others.
        console.error(
          `SyncGithubTasksAction: outward creation failed for ${notePath}`,
          error,
        );
      }
    }
  }

  // Creates the issue for one vault-born task and links it. Ordering is the
  // safety property: the issue is created first, so a failure throws before any
  // registry write and the entity is left untouched (retried next pass). The
  // mirror item is set immediately after the issue exists, so a later card
  // failure can never re-create the issue — the per-issue loop heals the
  // missing card on the next pass (membership gap).
  private async createOutward(
    existing: EntityRecord | null,
    vault: TaskData,
    notePath: string,
    input: SyncGithubTasksInput,
    identity: ProjectIdentityData,
    defaultLane: string,
  ): Promise<void> {
    const body = toIssueBody(vault.body);
    const handle = await this.projectManagement.createIssue(identity.repoUrl, {
      title: vault.title,
      body,
      type: vault.type,
    });

    // The entity is created only once the issue exists, so a failed creation
    // never leaves a dangling record.
    const record = existing ?? { id: crypto.randomUUID(), notePath };
    if (existing === null) {
      await this.syncState.setEntity(record);
    }

    // The base is a diff view of the canonical task, with the issue-comparable
    // body digest — the same form the next pass's diff reads.
    vault.id = record.id;
    const base = toDiffView(vault, body);
    await this.syncState.setMirrorItem(input.projectName, 'github', handle.url, {
      entityId: record.id,
      base,
    });

    // The card: add it and place it in the note's lane (the default lane when
    // the note carries none).
    await this.projectManagement.addBoardItem(identity.projectNodeId, handle.url);
    const lane = vault.status !== '' ? vault.status : defaultLane;
    if (lane !== '') {
      await this.projectManagement.setBoardStatus(
        identity.projectNodeId,
        identity.statusFieldId,
        handle.url,
        boardOptionIDByName(identity.statusOptions, lane),
      );
    }
  }

  // Whether an entity already holds a github mirror item. The registry is the
  // identity source, so this is the one check the outward phase needs to leave
  // an already-mirrored note untouched.
  private async hasGithubMirror(entityId: string): Promise<boolean> {
    return (
      (await this.syncState.findMirrorItemByEntity('github', entityId)) !== null
    );
  }
}

