import type { BoardItemData } from '../shared/BoardItemData.js';
import { BoardStatusData } from '../shared/BoardStatusData.js';
import type { GithubTaskData } from './GithubTaskData.js';
import type { ProjectIdentityData } from '../shared/ProjectIdentityData.js';
import { TaskData } from '../shared/TaskData.js';
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
import { toDiffView, toDiffViewWithBody } from '../shared/toDiffView.js';
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
import type {
  ConnectionSyncHalf,
  ConnectionSyncInput,
} from '../sync/SyncHalves.js';

const PENDING_CREATION_PREFIX = 'pendingCreation:';

function pendingCreationHandle(entityId: string): string {
  return `${PENDING_CREATION_PREFIX}${entityId}`;
}

function isPendingCreationHandle(handle: string): boolean {
  return handle.startsWith(PENDING_CREATION_PREFIX);
}

export interface SyncGithubTasksInput extends ConnectionSyncInput {
  projectName: string;
  syncedAt: string;
  includeBoard: boolean;
}

export class SyncGithubTasksAction implements ConnectionSyncHalf {
  readonly requiresBoard = true;

  constructor(
    readonly connectionSlug: string,
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly vault: VaultPort,
    private readonly applyToGithub: ApplyTaskToGithubAction,
    private readonly applyToVault: ApplyTaskToVaultAction,
    private readonly verdictResolver: VerdictResolver,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: ConnectionSyncInput): Promise<void> {
    const identity = await this.syncState.getIdentity(
      input.projectName,
      this.connectionSlug,
    );
    if (identity === null) {
      throw new Error(
        `SyncGithubTasksAction: no repo url for project ${input.projectName}`,
      );
    }
    if (identity.repoUrl === '') {
      return;
    }

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

    await this.adoptPendingIssues(
      issues,
      cardByUrl,
      input,
      doneLane,
      defaultLane,
    );

    for (const issue of issues) {
      const card = cardByUrl.get(issue.url) ?? null;
      const item = await this.syncState.findMirrorItem(
        this.connectionSlug,
        issue.url,
      );
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

    await this.materializeOutward(input, identity, doneLane, defaultLane);
  }

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
    await this.applyToVault.execute({
      task: remote,
      current: null,
      projectName: input.projectName,
      connectionSlug: this.connectionSlug,
      syncedAt: input.syncedAt,
      origin: 'pull',
    });
    await this.applyToGithub.execute({
      task: remote,
      current: issueAsFetched,
      hasCard: card !== null,
      projectName: input.projectName,
      connectionSlug: this.connectionSlug,
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
    vault.id = record.id;

    const { remote, issueAsFetched } = await this.remoteViews(
      issue,
      record,
      base,
      card,
      doneLane,
      defaultLane,
    );

    vault.parent = await this.resolveParent(note.content, input.projectName);

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
      await this.applyToGithub.execute({
        task: vault,
        current: issueAsFetched,
        hasCard: card !== null,
        projectName: input.projectName,
        connectionSlug: this.connectionSlug,
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
          connectionSlug: this.connectionSlug,
          syncedAt: input.syncedAt,
          origin: 'pull',
          record,
        });
      }
      const laneDone = remote.completedAt !== null;
      const stateDone = issueAsFetched.completedAt !== null;
      if (vetoed && base !== null) {
        await this.applyToGithub.execute({
          task: reconcileShape(remote, base),
          current: issueAsFetched,
          hasCard: card !== null,
          projectName: input.projectName,
          connectionSlug: this.connectionSlug,
          syncedAt: input.syncedAt,
        });
      } else if (laneDone !== stateDone) {
        await this.applyToGithub.execute({
          task: remote,
          current: issueAsFetched,
          hasCard: card !== null,
          projectName: input.projectName,
          connectionSlug: this.connectionSlug,
          syncedAt: input.syncedAt,
        });
      }
      return;
    }

    if (card === null || card.statusOptionName === undefined) {
      await this.applyToGithub.execute({
        task: remote,
        current: issueAsFetched,
        hasCard: card !== null,
        projectName: input.projectName,
        connectionSlug: this.connectionSlug,
        syncedAt: input.syncedAt,
      });
    }
  }

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

  private async parentUuidFromIssue(
    issue: GithubTaskData,
  ): Promise<string | null> {
    if (issue.parentUrl === null || issue.parentUrl === '') {
      return null;
    }
    const item = await this.syncState.findMirrorItem(
      this.connectionSlug,
      issue.parentUrl,
    );
    if (item === null) {
      return null;
    }
    return (await this.syncState.getEntity(item.entityId))?.id ?? null;
  }

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
      await this.syncState.setMirrorItem(
        projectName,
        this.connectionSlug,
        issue.url,
        {
          entityId: record.id,
          base,
        },
      );
    }
    return base;
  }

  private async hasVaultDrift(projectName: string): Promise<boolean> {
    const prefix = `Projecten/${projectName}/`;
    const entries = await this.syncState.listMirrorItems(
      projectName,
      this.connectionSlug,
    );
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
        console.warn(
          `SyncGithubTasksAction: unparseable note ${record.notePath}; not counting it as drift`,
        );
        continue;
      }
      if (!matchesBase(parsed, base)) {
        return true;
      }
    }
    return false;
  }

  private async hasOutwardDrift(projectName: string): Promise<boolean> {
    const folder = `Projecten/${projectName}/taken`;
    for (const notePath of await this.vault.listNotesInFolder(folder)) {
      const record = await this.syncState.findByNotePath(notePath);
      if (
        record !== null &&
        (await this.hasRealGithubMirror(projectName, record.id))
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
      if (parsed !== null && parsed.type !== '') {
        return true;
      }
    }
    return false;
  }

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
        (await this.hasRealGithubMirror(input.projectName, existing.id))
      ) {
        continue;
      }
      const lane = vault.status !== '' ? vault.status : defaultLane;
      const laneOption =
        lane === ''
          ? undefined
          : identity.statusOptions.find((option) => option.name === lane);
      if (lane !== '' && laneOption === undefined) {
        console.warn(
          `SyncGithubTasksAction: note ${notePath} carries lane "${lane}" which is not a board option; skipping outward creation`,
        );
        continue;
      }
      try {
        await this.createOutward(
          existing,
          vault,
          notePath,
          input,
          identity,
          laneOption?.id,
        );
      } catch (error) {
        console.error(
          `SyncGithubTasksAction: outward creation failed for ${notePath}`,
          error,
        );
      }
    }
  }

  private async createOutward(
    existing: EntityRecord | null,
    vault: TaskData,
    notePath: string,
    input: SyncGithubTasksInput,
    identity: ProjectIdentityData,
    laneOptionId: string | undefined,
  ): Promise<void> {
    const record = existing ?? { id: crypto.randomUUID(), notePath };
    if (existing === null) {
      await this.syncState.setEntity(record);
    }
    await this.ensurePlaceholder(record, input.projectName);

    const body = toIssueBody(vault.body);
    const handle = await this.projectManagement.createIssue(identity.repoUrl, {
      title: vault.title,
      body,
      type: vault.type,
      projectV2Ids: [identity.projectNodeId],
    });

    vault.id = record.id;
    const base = toDiffView(vault, body);
    await this.syncState.setMirrorItem(
      input.projectName,
      this.connectionSlug,
      handle.url,
      {
        entityId: record.id,
        base,
      },
    );
    await this.syncState.removeMirrorItem(
      input.projectName,
      this.connectionSlug,
      pendingCreationHandle(record.id),
    );

    if (laneOptionId !== undefined) {
      await this.projectManagement.setBoardStatus(
        new BoardStatusData({
          projectNodeId: identity.projectNodeId,
          statusFieldId: identity.statusFieldId,
          issueUrl: handle.url,
          statusOptionId: laneOptionId,
        }),
      );
    }
  }

  private async ensurePlaceholder(
    record: EntityRecord,
    projectName: string,
  ): Promise<void> {
    const item = await this.syncState.findMirrorItemByEntity(
      this.connectionSlug,
      record.id,
    );
    if (item !== null) {
      return;
    }
    await this.syncState.setMirrorItem(
      projectName,
      this.connectionSlug,
      pendingCreationHandle(record.id),
      { entityId: record.id, base: null },
    );
  }

  private async adoptPendingIssues(
    issues: GithubTaskData[],
    cardByUrl: Map<string, BoardItemData>,
    input: SyncGithubTasksInput,
    doneLane: string,
    defaultLane: string,
  ): Promise<void> {
    const items = await this.syncState.listMirrorItems(
      input.projectName,
      this.connectionSlug,
    );
    const pending = items.filter(({ handle }) =>
      isPendingCreationHandle(handle),
    );
    if (pending.length === 0) {
      return;
    }
    const mirrored = new Set(
      items
        .filter(({ handle }) => !isPendingCreationHandle(handle))
        .map(({ handle }) => handle),
    );
    const realByEntity = new Set(
      items
        .filter(({ handle }) => !isPendingCreationHandle(handle))
        .map(({ item }) => item.entityId),
    );
    for (const { handle, item } of pending) {
      const record = await this.syncState.getEntity(item.entityId);
      if (record === null) {
        await this.syncState.removeMirrorItem(
          input.projectName,
          this.connectionSlug,
          handle,
        );
        continue;
      }
      if (realByEntity.has(item.entityId)) {
        await this.syncState.removeMirrorItem(
          input.projectName,
          this.connectionSlug,
          handle,
        );
        continue;
      }
      const note = await this.vault.getNoteByPath(record.notePath);
      if (note === null) {
        continue;
      }
      const parsed = VaultTaskMapper.parseTask(note.content, record.notePath, {
        projectName: input.projectName,
        doneLane,
      });
      if (parsed === null || parsed.type === '') {
        continue;
      }
      const match = issues.find(
        (issue) =>
          !mirrored.has(issue.url) &&
          issue.state === 'open' &&
          typeFromLabels(issue.labels) === parsed.type &&
          issue.title === parsed.title,
      );
      if (match === undefined) {
        continue;
      }
      const card = cardByUrl.get(match.url) ?? null;
      const { remote } = await this.remoteViews(
        match,
        record,
        null,
        card,
        doneLane,
        defaultLane,
      );
      await this.syncState.setMirrorItem(
        input.projectName,
        this.connectionSlug,
        match.url,
        { entityId: record.id, base: toDiffViewWithBody(remote) },
      );
      await this.syncState.removeMirrorItem(
        input.projectName,
        this.connectionSlug,
        handle,
      );
      mirrored.add(match.url);
    }
  }

  private async hasRealGithubMirror(
    projectName: string,
    entityId: string,
  ): Promise<boolean> {
    const items = await this.syncState.listMirrorItems(
      projectName,
      this.connectionSlug,
    );
    return items.some(
      ({ handle, item }) =>
        item.entityId === entityId && !isPendingCreationHandle(handle),
    );
  }
}
